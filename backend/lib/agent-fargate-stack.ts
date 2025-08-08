import { Stack, StackProps, Duration, RemovalPolicy, CfnJson } from "aws-cdk-lib";
import { Construct } from "constructs";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as eks from "aws-cdk-lib/aws-eks";
import * as iam from "aws-cdk-lib/aws-iam";
import * as ecrAssets from "aws-cdk-lib/aws-ecr-assets";
import * as path from "path";
import { KubectlV32Layer } from "@aws-cdk/lambda-layer-kubectl-v32";

export class AgentEksFargateStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    // Create a VPC for our EKS cluster
    const vpc = new ec2.Vpc(this, "AgentVpc", {
      maxAzs: 2,
      natGateways: 1,
    });

    // Create master role
    const masterRole = new iam.Role(this, "ClusterMasterRole", {
      assumedBy: new iam.AccountRootPrincipal(),
    });

    // Create EKS Fargate cluster
    const cluster = new eks.FargateCluster(this, "AgentCluster", {
      vpc,
      version: eks.KubernetesVersion.V1_32,
      mastersRole: masterRole,
      outputClusterName: true,
      endpointAccess: eks.EndpointAccess.PUBLIC_AND_PRIVATE,
      vpcSubnets: [{ subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS }],
      kubectlLayer: new KubectlV32Layer(this, "kubectl"),
    });

    // Create IAM role for service account
    const k8sAppNameSpace = "default";
    const k8sAppServiceAccount = "agent-service-account";
    
    const conditions = new CfnJson(this, "ConditionJson", {
      value: {
        [`${cluster.clusterOpenIdConnectIssuer}:aud`]: "sts.amazonaws.com",
        [`${cluster.clusterOpenIdConnectIssuer}:sub`]: `system:serviceaccount:${k8sAppNameSpace}:${k8sAppServiceAccount}`,
      },
    });

    const iamPrinciple = new iam.FederatedPrincipal(
      cluster.openIdConnectProvider.openIdConnectProviderArn,
      {},
      "sts:AssumeRoleWithWebIdentity"
    ).withConditions({
      StringEquals: conditions,
    });

    const iamRoleForK8sSa = new iam.Role(this, "AgentServiceRole", {
      assumedBy: iamPrinciple,
    });

    // Add Bedrock permissions
    iamRoleForK8sSa.addToPrincipalPolicy(
      new iam.PolicyStatement({
        actions: ["bedrock:InvokeModel", "bedrock:InvokeModelWithResponseStream"],
        resources: ["*"],
      })
    );

    // Add Fargate profile
    const fargateProfile = cluster.addFargateProfile("AgentProfile", {
      selectors: [{ namespace: k8sAppNameSpace, labels: { app: "agent-service" } }],
      subnetSelection: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
    });

    // Build Docker image
    const dockerAsset = new ecrAssets.DockerImageAsset(this, "AgentImage", {
      directory: path.join(__dirname, "../docker"),
      platform: ecrAssets.Platform.LINUX_AMD64,
    });

    // Create service account
    const serviceAccountManifest = {
      apiVersion: "v1",
      kind: "ServiceAccount",
      metadata: {
        name: k8sAppServiceAccount,
        namespace: k8sAppNameSpace,
        annotations: {
          "eks.amazonaws.com/role-arn": iamRoleForK8sSa.roleArn,
        },
      },
    };

    // Create deployment
    const deployment = {
      apiVersion: "apps/v1",
      kind: "Deployment",
      metadata: {
        name: "agent-service",
        namespace: k8sAppNameSpace,
        labels: { app: "agent-service" },
      },
      spec: {
        replicas: 2,
        selector: { matchLabels: { app: "agent-service" } },
        template: {
          metadata: { labels: { app: "agent-service" } },
          spec: {
            serviceAccountName: k8sAppServiceAccount,
            containers: [{
              name: "agent-container",
              image: dockerAsset.imageUri,
              ports: [{ containerPort: 8000 }],
              resources: {
                requests: { memory: "256Mi", cpu: "250m" },
                limits: { memory: "512Mi", cpu: "500m" },
              },
              livenessProbe: {
                httpGet: { path: "/health", port: 8000 },
                initialDelaySeconds: 30,
                periodSeconds: 10,
              },
              readinessProbe: {
                httpGet: { path: "/health", port: 8000 },
                initialDelaySeconds: 5,
                periodSeconds: 5,
              },
            }],
          },
        },
      },
    };

    // Create service
    const service = {
      apiVersion: "v1",
      kind: "Service",
      metadata: {
        name: "agent-service",
        namespace: k8sAppNameSpace,
        labels: { app: "agent-service" },
      },
      spec: {
        type: "ClusterIP",
        ports: [{ port: 80, targetPort: 8000 }],
        selector: { app: "agent-service" },
      },
    };

    // Apply manifests
    const saManifest = cluster.addManifest("AgentServiceAccount", serviceAccountManifest);
    const deployManifest = cluster.addManifest("AgentDeployment", deployment);
    const svcManifest = cluster.addManifest("AgentService", service);
    
    saManifest.node.addDependency(fargateProfile);
    deployManifest.node.addDependency(saManifest);
    svcManifest.node.addDependency(deployManifest);

    // Install AWS Load Balancer Controller
    const albServiceAccount = cluster.addServiceAccount("AWSLoadBalancerController", {
      name: "aws-load-balancer-controller",
      namespace: "kube-system",
    });

    // Add ALB controller permissions
    albServiceAccount.addToPrincipalPolicy(
      new iam.PolicyStatement({
        actions: [
          "iam:CreateServiceLinkedRole",
          "ec2:Describe*",
          "ec2:CreateSecurityGroup",
          "ec2:CreateTags",
          "ec2:DeleteTags",
          "ec2:AuthorizeSecurityGroupIngress",
          "ec2:RevokeSecurityGroupIngress",
          "elasticloadbalancing:*",
          "acm:ListCertificates",
          "acm:DescribeCertificate",
          "iam:ListServerCertificates",
          "iam:GetServerCertificate",
          "waf-regional:*",
          "wafv2:*",
          "shield:*",
        ],
        resources: ["*"],
      })
    );

    const albChart = cluster.addHelmChart("AWSLoadBalancerController", {
      chart: "aws-load-balancer-controller",
      repository: "https://aws.github.io/eks-charts",
      namespace: "kube-system",
      release: "aws-load-balancer-controller",
      version: "1.8.0",
      values: {
        clusterName: cluster.clusterName,
        serviceAccount: {
          create: false,
          name: "aws-load-balancer-controller",
        },
        region: this.region,
        vpcId: vpc.vpcId,
      },
      timeout: Duration.minutes(15),
      wait: true,
    });

    albChart.node.addDependency(albServiceAccount);

    // Create ingress
    const ingress = {
      apiVersion: "networking.k8s.io/v1",
      kind: "Ingress",
      metadata: {
        name: "agent-ingress",
        namespace: k8sAppNameSpace,
        annotations: {
          "alb.ingress.kubernetes.io/scheme": "internet-facing",
          "alb.ingress.kubernetes.io/target-type": "ip",
          "alb.ingress.kubernetes.io/healthcheck-path": "/health",
        },
      },
      spec: {
        ingressClassName: "alb",
        rules: [{
          http: {
            paths: [{
              path: "/",
              pathType: "Prefix",
              backend: {
                service: {
                  name: "agent-service",
                  port: { number: 80 },
                },
              },
            }],
          },
        }],
      },
    };

    const ingressManifest = cluster.addManifest("AgentIngress", ingress);
    ingressManifest.node.addDependency(albChart);
    ingressManifest.node.addDependency(svcManifest);

    // Output the cluster name and endpoint
    this.exportValue(cluster.clusterName, {
      name: "AgentClusterName",
      description: "The name of the EKS cluster",
    });

    this.exportValue(cluster.clusterEndpoint, {
      name: "AgentClusterEndpoint",
      description: "The endpoint of the EKS cluster",
    });
  }
}