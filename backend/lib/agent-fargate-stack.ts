import { Stack, StackProps, Duration, RemovalPolicy, CfnJson } from "aws-cdk-lib";
import { Construct } from "constructs";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as eks from "aws-cdk-lib/aws-eks";
import * as iam from "aws-cdk-lib/aws-iam";
import * as logs from "aws-cdk-lib/aws-logs";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as apigateway from "aws-cdk-lib/aws-apigateway";
import * as ecrAssets from "aws-cdk-lib/aws-ecr-assets";
import * as path from "path";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as s3n from "aws-cdk-lib/aws-s3-notifications";
import { KubectlV32Layer } from "@aws-cdk/lambda-layer-kubectl-v32";
import { KubernetesPatch } from "aws-cdk-lib/aws-eks"; // CHANGE: add patch construct

export class AgentEksFargateStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    // VPC
    const vpc = new ec2.Vpc(this, "AgentVpc", {
      maxAzs: 2,
      natGateways: 1,
    });

    // Cluster master role
    const masterRole = new iam.Role(this, "ClusterMasterRole", {
      assumedBy: new iam.AccountRootPrincipal(),
    });
    masterRole.applyRemovalPolicy(RemovalPolicy.DESTROY);

    // EKS Fargate cluster
    const cluster = new eks.FargateCluster(this, "AgentCluster", {
      vpc,
      version: eks.KubernetesVersion.V1_32,
      mastersRole: masterRole,
      outputClusterName: true,
      endpointAccess: eks.EndpointAccess.PUBLIC_AND_PRIVATE,
      vpcSubnets: [{ subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS }],
      kubectlLayer: new KubectlV32Layer(this, "kubectl"),
    });



    // IRSA service account setup
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
    ).withConditions({ StringEquals: conditions });

    const iamRoleForK8sSa = new iam.Role(this, "AgentServiceRole", {
      assumedBy: iamPrinciple,
    });

    // Logs
    const logGroup = new logs.LogGroup(this, "AgentLogGroup", {
      logGroupName: `/aws/eks/${cluster.clusterName}/agent-service`,
      retention: logs.RetentionDays.ONE_WEEK,
      removalPolicy: RemovalPolicy.DESTROY,
    });

    // DynamoDB (feedback)
    const feedbackTable = new dynamodb.Table(this, "FeedbackTable", {
      tableName: `iecho-feedback-table-${this.stackName}`,
      partitionKey: { name: "feedbackId", type: dynamodb.AttributeType.STRING },
      timeToLiveAttribute: "ttl",
      removalPolicy: RemovalPolicy.DESTROY,
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
    });

    // IAM perms
    iamRoleForK8sSa.addToPrincipalPolicy(new iam.PolicyStatement({
      actions: [
        "bedrock:InvokeModel",
        "bedrock:InvokeModelWithResponseStream",
        "bedrock:RetrieveAndGenerate",
        "bedrock:Retrieve",
        "bedrock:GetInferenceProfile",
        "bedrock-agent-runtime:Retrieve",
        "bedrock-agent-runtime:RetrieveAndGenerate",
      ],
      resources: ["*"],
    }));
    iamRoleForK8sSa.addToPrincipalPolicy(new iam.PolicyStatement({
      actions: ["bedrock:GetDataSource", "bedrock:ListDataSources", "s3:GetObject", "s3:ListBucket"],
      resources: ["*"],
    }));
    iamRoleForK8sSa.addToPrincipalPolicy(new iam.PolicyStatement({
      actions: ["logs:CreateLogStream", "logs:PutLogEvents", "logs:DescribeLogGroups", "logs:DescribeLogStreams"],
      resources: [logGroup.logGroupArn + ":*"],
    }));
    iamRoleForK8sSa.addToPrincipalPolicy(new iam.PolicyStatement({
      actions: ["dynamodb:PutItem", "dynamodb:GetItem", "dynamodb:Query", "dynamodb:Scan"],
      resources: [feedbackTable.tableArn],
    }));

    // Fargate profile
    const fargateProfile = cluster.addFargateProfile("AgentProfile", {
      selectors: [{ namespace: k8sAppNameSpace, labels: { app: "agent-service" } }],
      subnetSelection: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
    });

    // KB id
    const knowledgeBaseId = this.node.tryGetContext("knowledgeBaseId") || "PLACEHOLDER";
    
    // Optional: Office-to-PDF processor
    const documentsBucketName = this.node.tryGetContext("documentsBucketName");
    if (documentsBucketName) {
      const documentsBucket = s3.Bucket.fromBucketName(this, "DocumentsBucket", documentsBucketName);
      
      const officeToPdfLambda = new lambda.Function(this, "OfficeToPdfFunction", {
        runtime: lambda.Runtime.NODEJS_18_X,
        handler: "index.s3Handler",
        code: lambda.Code.fromAsset(path.join(__dirname, "../lambda/office-to-pdf")),
        timeout: Duration.minutes(15),
        memorySize: 1536,
        layers: [
          lambda.LayerVersion.fromLayerVersionArn(
            this,
            "LibreOfficeLayer",
            `arn:aws:lambda:${this.region}:764866452798:layer:libreoffice-brotli:1`
          )
        ],
        environment: {
          BUCKET: documentsBucketName,
          FONTCONFIG_PATH: "/var/task/fonts"
        }
      });
      
      documentsBucket.grantReadWrite(officeToPdfLambda);
      documentsBucket.grantDelete(officeToPdfLambda);
      
      documentsBucket.addEventNotification(
        s3.EventType.OBJECT_CREATED,
        new s3n.LambdaDestination(officeToPdfLambda),
        { prefix: "uploads/", suffix: ".pptx" }
      );
      
      documentsBucket.addEventNotification(
        s3.EventType.OBJECT_CREATED,
        new s3n.LambdaDestination(officeToPdfLambda),
        { prefix: "uploads/", suffix: ".docx" }
      );
      
      documentsBucket.addEventNotification(
        s3.EventType.OBJECT_CREATED,
        new s3n.LambdaDestination(officeToPdfLambda),
        { prefix: "uploads/", suffix: ".xlsx" }
      );
      
      documentsBucket.addEventNotification(
        s3.EventType.OBJECT_CREATED,
        new s3n.LambdaDestination(officeToPdfLambda),
        { prefix: "uploads/", suffix: ".pdf" }
      );
    }

    // App image
    const dockerAsset = new ecrAssets.DockerImageAsset(this, "AgentImage", {
      directory: path.join(__dirname, "../docker"),
      platform: ecrAssets.Platform.LINUX_AMD64,
    });

    // ALB Controller SA
    const albServiceAccount = cluster.addServiceAccount("AWSLoadBalancerController", {
      name: "aws-load-balancer-controller",
      namespace: "kube-system",
    });

    albServiceAccount.addToPrincipalPolicy(new iam.PolicyStatement({
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
    }));

    // ALB Controller Helm chart
    const albChart = cluster.addHelmChart("AWSLoadBalancerController", {
      chart: "aws-load-balancer-controller",
      repository: "https://aws.github.io/eks-charts",
      namespace: "kube-system",
      release: "aws-load-balancer-controller",
      version: "1.8.0",
      values: {
        clusterName: cluster.clusterName,
        serviceAccount: { create: false, name: "aws-load-balancer-controller" },
        region: this.region,
        vpcId: vpc.vpcId,
        enableShield: false,
        enableWaf: false,
        enableWafv2: false,
      },
      timeout: Duration.minutes(15),
      wait: true,
      createNamespace: false,
    });
    albChart.node.addDependency(albServiceAccount);

    // K8s manifests (SA, Deployment, Service, Ingress)
    const serviceAccountManifest = {
      apiVersion: "v1",
      kind: "ServiceAccount",
      metadata: {
        name: k8sAppServiceAccount,
        namespace: k8sAppNameSpace,
        annotations: { "eks.amazonaws.com/role-arn": iamRoleForK8sSa.roleArn },
      },
    };

    const deployment = {
      apiVersion: "apps/v1",
      kind: "Deployment",
      metadata: { name: "agent-service", namespace: k8sAppNameSpace, labels: { app: "agent-service" } },
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
                { name: "FEEDBACK_TABLE_NAME", value: feedbackTable.tableName },
              ],
              resources: {
                requests: { memory: "512Mi", cpu: "500m" },
                limits: { memory: "1Gi", cpu: "1000m" },
              },
              livenessProbe: { httpGet: { path: "/health", port: 8000 }, initialDelaySeconds: 30, periodSeconds: 10 },
              readinessProbe: { httpGet: { path: "/health", port: 8000 }, initialDelaySeconds: 5, periodSeconds: 5 },
            }],
          },
        },
      },
    };

    const service = {
      apiVersion: "v1",
      kind: "Service",
      metadata: { name: "agent-service", namespace: k8sAppNameSpace, labels: { app: "agent-service" } },
      spec: { type: "ClusterIP", ports: [{ port: 80, targetPort: 8000 }], selector: { app: "agent-service" } },
    };

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
          "alb.ingress.kubernetes.io/load-balancer-attributes":
            "deletion_protection.enabled=false,idle_timeout.timeout_seconds=300",
          "alb.ingress.kubernetes.io/target-group-attributes":
            "deregistration_delay.timeout_seconds=30", // CHANGE: faster TG drain on delete
          "alb.ingress.kubernetes.io/tags": "Environment=dev,ManagedBy=CDK",
          "kubernetes.io/ingress.class": "alb",
          // CHANGE: removed manual finalizer annotation
        },
      },
      spec: {
        ingressClassName: "alb",
        rules: [{
          http: {
            paths: [{
              path: "/",
              pathType: "Prefix",
              backend: { service: { name: "agent-service", port: { number: 80 } } },
            }],
          },
        }],
      },
    };

    const saManifest = cluster.addManifest("AgentServiceAccount", serviceAccountManifest);
    const deployManifest = cluster.addManifest("AgentDeployment", deployment);
    const svcManifest = cluster.addManifest("AgentService", service);
    const ingressManifest = cluster.addManifest("AgentIngress", ingress);

    // Create-order (controller first), delete-order reversed (Ingress deleted while controller is alive)
    saManifest.node.addDependency(fargateProfile);
    deployManifest.node.addDependency(saManifest);
    deployManifest.node.addDependency(albChart);
    svcManifest.node.addDependency(deployManifest);
    svcManifest.node.addDependency(albChart);
    ingressManifest.node.addDependency(svcManifest);
    ingressManifest.node.addDependency(albChart);

    // CHANGE: ensure aws-auth is created before (and deleted last)
    saManifest.node.addDependency(cluster.awsAuth);
    deployManifest.node.addDependency(cluster.awsAuth);
    svcManifest.node.addDependency(cluster.awsAuth);
    ingressManifest.node.addDependency(cluster.awsAuth);
    albChart.node.addDependency(cluster.awsAuth);

    // CHANGE: delete-time safety net — strip any lingering finalizers
    const ingressFinalizerPatch = new KubernetesPatch(this, "IngressFinalizerPatch", {
      cluster,
      resourceName: "ingress/agent-ingress",
      resourceNamespace: k8sAppNameSpace,
      applyPatch: { metadata: { annotations: { "cdk.aws/finalizer-patch": "applied" } } }, // no-op at create/update
      restorePatch: { metadata: { finalizers: [] } }, // executed at DELETE time
    });
    ingressFinalizerPatch.node.addDependency(ingressManifest);

    // Expose ALB hostname
    const albDnsProvider = new eks.KubernetesObjectValue(this, "AlbDnsProvider", {
      cluster,
      objectType: "ingress",
      objectName: "agent-ingress",
      objectNamespace: k8sAppNameSpace,
      jsonPath: ".status.loadBalancer.ingress[0].hostname",
    });
    albDnsProvider.node.addDependency(ingressManifest);

    // API Gateway → ALB
    const api = new apigateway.RestApi(this, "AgentApi", {
      restApiName: "iECHO Agent API",
      description: "API Gateway for iECHO RAG Chatbot",
      defaultCorsPreflightOptions: {
        allowOrigins: apigateway.Cors.ALL_ORIGINS,
        allowMethods: apigateway.Cors.ALL_METHODS,
        allowHeaders: ["Content-Type", "X-Amz-Date", "Authorization", "X-Api-Key"],
      },
    });

    const albIntegration = new apigateway.HttpIntegration(`http://${albDnsProvider.value}/{proxy}`, {
      httpMethod: "ANY",
      options: { requestParameters: { "integration.request.path.proxy": "method.request.path.proxy" } },
    });

    const proxyResource = api.root.addResource("{proxy+}");
    proxyResource.addMethod("ANY", albIntegration, { requestParameters: { "method.request.path.proxy": true } });

    const rootIntegration = new apigateway.HttpIntegration(`http://${albDnsProvider.value}`, { httpMethod: "ANY" });
    api.root.addMethod("ANY", rootIntegration);
    
    // Ensure API Gateway waits for ALB DNS
    api.node.addDependency(albDnsProvider);

    // Outputs
    this.exportValue(api.url, { name: "ApiGatewayUrl", description: "The API Gateway URL" });
    this.exportValue(albDnsProvider.value, { name: "AlbDnsName", description: "The ALB DNS name" });
    this.exportValue(cluster.clusterName, { name: "AgentClusterName", description: "The name of the EKS cluster" });
    this.exportValue(cluster.clusterEndpoint, { name: "AgentClusterEndpoint", description: "The endpoint of the EKS cluster" });
  }
}
