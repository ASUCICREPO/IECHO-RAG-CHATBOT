import { Stack, StackProps, Duration, RemovalPolicy, CfnJson } from "aws-cdk-lib";
import { Construct } from "constructs";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as eks from "aws-cdk-lib/aws-eks";
import * as iam from "aws-cdk-lib/aws-iam";
import * as logs from "aws-cdk-lib/aws-logs";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as apigateway from "aws-cdk-lib/aws-apigateway";
import * as ssm from "aws-cdk-lib/aws-ssm";
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
    
    masterRole.applyRemovalPolicy(RemovalPolicy.DESTROY);

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

    // Create CloudWatch log group
    const logGroup = new logs.LogGroup(this, "AgentLogGroup", {
      logGroupName: `/aws/eks/${cluster.clusterName}/agent-service`,
      retention: logs.RetentionDays.ONE_WEEK,
      removalPolicy: RemovalPolicy.DESTROY
    });

    // Create DynamoDB table for feedback
    const feedbackTable = new dynamodb.Table(this, "FeedbackTable", {
      tableName: `iecho-feedback-table-${this.stackName}`,
      partitionKey: { name: "feedbackId", type: dynamodb.AttributeType.STRING },
      timeToLiveAttribute: "ttl",
      removalPolicy: RemovalPolicy.DESTROY,
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST
    });

    // Add Bedrock and CloudWatch permissions
    iamRoleForK8sSa.addToPrincipalPolicy(
      new iam.PolicyStatement({
        actions: [
          "bedrock:InvokeModel", 
          "bedrock:InvokeModelWithResponseStream",
          "bedrock:RetrieveAndGenerate",
          "bedrock:Retrieve",
          "bedrock:GetInferenceProfile",
          "bedrock-agent-runtime:Retrieve",
          "bedrock-agent-runtime:RetrieveAndGenerate"
        ],
        resources: ["*"],
      })
    );

    iamRoleForK8sSa.addToPrincipalPolicy(
      new iam.PolicyStatement({
        actions: [
          "logs:CreateLogStream",
          "logs:PutLogEvents",
          "logs:DescribeLogGroups",
          "logs:DescribeLogStreams"
        ],
        resources: [logGroup.logGroupArn + ":*"],
      })
    );

    iamRoleForK8sSa.addToPrincipalPolicy(
      new iam.PolicyStatement({
        actions: [
          "dynamodb:PutItem",
          "dynamodb:GetItem",
          "dynamodb:Query",
          "dynamodb:Scan"
        ],
        resources: [feedbackTable.tableArn],
      })
    );

    // Add Fargate profile
    const fargateProfile = cluster.addFargateProfile("AgentProfile", {
      selectors: [{ namespace: k8sAppNameSpace, labels: { app: "agent-service" } }],
      subnetSelection: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
    });

    // Get knowledge base ID from context
    const knowledgeBaseId = this.node.tryGetContext('knowledgeBaseId') || 'PLACEHOLDER';

    // Build Docker image
    const dockerAsset = new ecrAssets.DockerImageAsset(this, "AgentImage", {
      directory: path.join(__dirname, "../docker"),
      platform: ecrAssets.Platform.LINUX_AMD64,
    });

    // Install AWS Load Balancer Controller first
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
              env: [
                { name: "KNOWLEDGE_BASE_ID", value: knowledgeBaseId },
                { name: "AWS_REGION", value: this.region },
                { name: "AWS_ACCOUNT_ID", value: this.account },
                { name: "LOG_GROUP", value: logGroup.logGroupName },
                { name: "FEEDBACK_TABLE_NAME", value: feedbackTable.tableName }
              ],
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
          "alb.ingress.kubernetes.io/load-balancer-attributes": "deletion_protection.enabled=false",
          "alb.ingress.kubernetes.io/tags": "Environment=dev,ManagedBy=CDK",
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

    // Apply manifests with proper dependencies
    const saManifest = cluster.addManifest("AgentServiceAccount", serviceAccountManifest);
    const deployManifest = cluster.addManifest("AgentDeployment", deployment);
    const svcManifest = cluster.addManifest("AgentService", service);
    const ingressManifest = cluster.addManifest("AgentIngress", ingress);
    
    saManifest.node.addDependency(fargateProfile);
    deployManifest.node.addDependency(saManifest);
    svcManifest.node.addDependency(deployManifest);
    svcManifest.node.addDependency(albChart);
    ingressManifest.node.addDependency(svcManifest);
    ingressManifest.node.addDependency(albChart);

    // Get ALB DNS name from ingress (available after deployment)
    const albDnsProvider = new eks.KubernetesObjectValue(this, "AlbDnsProvider", {
      cluster,
      objectType: "ingress",
      objectName: "agent-ingress",
      objectNamespace: k8sAppNameSpace,
      jsonPath: ".status.loadBalancer.ingress[0].hostname",
    });
    
    albDnsProvider.node.addDependency(ingressManifest);

    // Create API Gateway
    const api = new apigateway.RestApi(this, "AgentApi", {
      restApiName: "iECHO Agent API",
      description: "API Gateway for iECHO RAG Chatbot",
      defaultCorsPreflightOptions: {
        allowOrigins: apigateway.Cors.ALL_ORIGINS,
        allowMethods: apigateway.Cors.ALL_METHODS,
        allowHeaders: ['Content-Type', 'X-Amz-Date', 'Authorization', 'X-Api-Key'],
      },
    });

    // Create HTTP integration to ALB (using token for dynamic URL)
    const albIntegration = new apigateway.HttpIntegration(`http://${albDnsProvider.value}/{proxy}`, {
      httpMethod: 'ANY',
      options: {
        requestParameters: {
          'integration.request.path.proxy': 'method.request.path.proxy',
        },
      },
    });

    // Add proxy resource
    const proxyResource = api.root.addResource('{proxy+}');
    proxyResource.addMethod('ANY', albIntegration, {
      requestParameters: {
        'method.request.path.proxy': true,
      },
    });

    // Add root method (without proxy parameter)
    const rootIntegration = new apigateway.HttpIntegration(`http://${albDnsProvider.value}`, {
      httpMethod: 'ANY',
    });
    api.root.addMethod('ANY', rootIntegration);

    // Output API Gateway URL
    this.exportValue(api.url, {
      name: "ApiGatewayUrl",
      description: "The API Gateway URL",
    });

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