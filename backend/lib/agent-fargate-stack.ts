// Core CDK imports: base Stack primitives and utilities.
// - CfnJson lets us inject arbitrary JSON into synthesized CFN (useful for OIDC conditions).
// - SecretValue is imported (not used below) but can hold sensitive strings without plain-text.
import { Stack, StackProps, Duration, RemovalPolicy, CfnJson, SecretValue } from "aws-cdk-lib";
import { Construct } from "constructs";

// AWS service namespaces used throughout this stack.
import * as ec2 from "aws-cdk-lib/aws-ec2";              // VPC, subnets, endpoints
import * as eks from "aws-cdk-lib/aws-eks";              // EKS cluster, Fargate profiles, manifests
import * as iam from "aws-cdk-lib/aws-iam";              // Roles, policies, principals
import * as logs from "aws-cdk-lib/aws-logs";            // CloudWatch Logs groups/retention
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";    // Feedback table
import * as apigateway from "aws-cdk-lib/aws-apigateway";// REST API to front ALB
import * as ecrAssets from "aws-cdk-lib/aws-ecr-assets"; // Build/publish Docker image asset
import * as amplify from "aws-cdk-lib/aws-amplify";      // Amplify app (manual deploy)

// Node helpers and additional AWS services
import * as path from "path";
import * as lambda from "aws-cdk-lib/aws-lambda";        // Optional office-to-PDF Lambda
import * as s3 from "aws-cdk-lib/aws-s3";                // Docs bucket
import * as s3n from "aws-cdk-lib/aws-s3-notifications"; // S3 -> Lambda notifications

// Kubectl layer for CDK to apply k8s manifests and a patch construct for cleanup behavior.
import { KubectlV32Layer } from "@aws-cdk/lambda-layer-kubectl-v32";
import { KubernetesPatch } from "aws-cdk-lib/aws-eks";

// cdk8s lets us define raw Kubernetes API objects in code with strong typing.
import * as cdk8s from "cdk8s";

// Props passed into our cdk8s chart for templating K8s objects (no AWS calls here).
interface AgentAppChartProps {
  iamRoleArn: string;          // IRSA role to associate with the K8s service account
  namespace: string;           // Kubernetes namespace to deploy to
  serviceAccountName: string;  // K8s service account name used by the pod
  imageUri: string;            // Container image (from ECR asset)
  knowledgeBaseId: string;     // Bedrock KB ID injected as env var
  region: string;              // AWS region injected as env var
  accountId: string;           // AWS account injected as env var
  logGroupName: string;        // Log group name injected as env var (optional usage in the app)
  feedbackTableName: string;   // DynamoDB table name for feedback writes
}

// cdk8s chart that defines ServiceAccount, Deployment, Service, and Ingress for the app.
class AgentAppChart extends cdk8s.Chart {
  constructor(scope: cdk8s.App, id: string, props: AgentAppChartProps) {
    // Attach all resources to a specific namespace for scoping.
    super(scope, id, { namespace: props.namespace });

    // ---- ServiceAccount (with IRSA annotation) ----
    new cdk8s.ApiObject(this, "service-account", {
      apiVersion: "v1",
      kind: "ServiceAccount",
      metadata: {
        name: props.serviceAccountName,
        namespace: props.namespace,
        annotations: {
          // This annotation is how EKS maps the K8s SA to an IAM Role via OIDC (IRSA).
          "eks.amazonaws.com/role-arn": props.iamRoleArn
        }
      }
    });

    // ---- Deployment (app pods on Fargate) ----
    new cdk8s.ApiObject(this, "deployment", {
      apiVersion: "apps/v1",
      kind: "Deployment",
      metadata: {
        name: "agent-service",
        namespace: props.namespace,
        labels: { app: "agent-service" } // Used by Service/Selectors
      },
      spec: {
        replicas: 2, // Run two pods for basic HA
        selector: { matchLabels: { app: "agent-service" } },
        template: {
          metadata: { labels: { app: "agent-service" } },
          spec: {
            // Ensure pod uses the IRSA-enabled ServiceAccount above
            serviceAccountName: props.serviceAccountName,
            containers: [{
              name: "agent-container",
              image: props.imageUri,                // Supplied by ECR DockerImageAsset
              ports: [{ containerPort: 8000 }],     // App serves HTTP on 8000
              env: [
                // App configuration (avoid secrets here; use K8s Secrets/IAM when needed)
                { name: "KNOWLEDGE_BASE_ID", value: props.knowledgeBaseId },
                { name: "AWS_REGION", value: props.region },
                { name: "AWS_ACCOUNT_ID", value: props.accountId },
                { name: "LOG_GROUP", value: props.logGroupName },
                { name: "FEEDBACK_TABLE_NAME", value: props.feedbackTableName },
              ],
              resources: {
                // Conservative Fargate sizing; adjust if app is CPU/memory constrained.
                requests: { memory: "512Mi", cpu: "500m" },
                limits: { memory: "1Gi", cpu: "1000m" }
              },
              // Simple health endpoints: ALB + K8s use these to gate traffic.
              livenessProbe: {
                httpGet: { path: "/health", port: 8000 },
                initialDelaySeconds: 30,
                periodSeconds: 10
              },
              readinessProbe: {
                httpGet: { path: "/health", port: 8000 },
                initialDelaySeconds: 5,
                periodSeconds: 5
              }
            }]
          }
        }
      }
    });

    // ---- ClusterIP Service (internal stable endpoint for pods) ----
    new cdk8s.ApiObject(this, "service", {
      apiVersion: "v1",
      kind: "Service",
      metadata: {
        name: "agent-service",
        namespace: props.namespace,
        labels: { app: "agent-service" }
      },
      spec: {
        type: "ClusterIP",                           // Not exposed externally—Ingress will handle that
        ports: [{ port: 80, targetPort: 8000 }],     // Map external 80 -> container 8000
        selector: { app: "agent-service" }           // Match the Deployment's labels
      }
    });

    // ---- Ingress (AWS Load Balancer Controller will provision an internet-facing ALB) ----
    new cdk8s.ApiObject(this, "ingress", {
      apiVersion: "networking.k8s.io/v1",
      kind: "Ingress",
      metadata: {
        name: "agent-ingress",
        namespace: props.namespace,
        annotations: {
          // Public ALB
          "alb.ingress.kubernetes.io/scheme": "internet-facing",
          // Target pods directly (Fargate uses IP targets)
          "alb.ingress.kubernetes.io/target-type": "ip",
          // Health check target path used by ALB
          "alb.ingress.kubernetes.io/healthcheck-path": "/health",
          // Shorten deregistration and idle timeout for faster tear-down and long polling
          "alb.ingress.kubernetes.io/load-balancer-attributes": "deletion_protection.enabled=false,idle_timeout.timeout_seconds=300",
          "alb.ingress.kubernetes.io/target-group-attributes": "deregistration_delay.timeout_seconds=30",
          // Route reconciliation handled by AWS Load Balancer Controller
          "kubernetes.io/ingress.class": "alb"
        }
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
                  port: { number: 80 }
                }
              }
            }]
          }
        }]
      }
    });
  }
}

// Main CDK stack that stands up VPC, EKS Fargate, IAM/IRSA, logging, DDB, ALB controller, API Gateway, and Amplify.
export class AgentEksFargateStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    // ---- Networking (VPC + subnets + NAT) ----
    const vpc = new ec2.Vpc(this, "AgentVpc", {
      maxAzs: 2,        // Multi-AZ for HA
      natGateways: 1,   // Cost-optimized while allowing private subnets egress
    });

    // ---- VPC Endpoints to keep traffic private/cost-optimized (and avoid NAT where possible) ----
    vpc.addGatewayEndpoint("S3Endpoint", {
      service: ec2.GatewayVpcEndpointAwsService.S3, // S3 uses Gateway endpoint type
    });
    vpc.addGatewayEndpoint("DynamoDbEndpoint", {
      service: ec2.GatewayVpcEndpointAwsService.DYNAMODB,
    });
    vpc.addInterfaceEndpoint("EcrApi", {
      service: ec2.InterfaceVpcEndpointAwsService.ECR,
    });
    vpc.addInterfaceEndpoint("EcrDkr", {
      service: ec2.InterfaceVpcEndpointAwsService.ECR_DOCKER,
    });
    vpc.addInterfaceEndpoint("CloudWatchLogs", {
      service: ec2.InterfaceVpcEndpointAwsService.CLOUDWATCH_LOGS,
    });
    vpc.addInterfaceEndpoint("Bedrock", {
      // Bedrock runtime private access (regional service name format)
      service: new ec2.InterfaceVpcEndpointService(`com.amazonaws.${this.region}.bedrock-runtime`),
    });
    vpc.addInterfaceEndpoint("BedrockAgent", {
      // Bedrock Agent runtime private access
      service: new ec2.InterfaceVpcEndpointService(`com.amazonaws.${this.region}.bedrock-agent`),
    });
    vpc.addInterfaceEndpoint("Sts", {
      service: ec2.InterfaceVpcEndpointAwsService.STS,
    });
    vpc.addInterfaceEndpoint("Eks", {
      service: ec2.InterfaceVpcEndpointAwsService.EKS,
    });
    vpc.addInterfaceEndpoint("Ec2", {
      service: ec2.InterfaceVpcEndpointAwsService.EC2,
    });
    vpc.addInterfaceEndpoint("Lambda", {
      service: ec2.InterfaceVpcEndpointAwsService.LAMBDA,
    });

    // ---- Admin role for kubectl access to the control plane (mastersRole) ----
    const masterRole = new iam.Role(this, "ClusterMasterRole", {
      assumedBy: new iam.AccountRootPrincipal(), // Root principle; control via awsAuth mappings too
    });
    masterRole.applyRemovalPolicy(RemovalPolicy.DESTROY); // Clean up role on stack delete

    // ---- EKS Fargate Cluster ----
    const cluster = new eks.FargateCluster(this, "AgentCluster", {
      vpc,
      version: eks.KubernetesVersion.V1_32,        // Newer EKS version (ensure kubectl layer matches)
      mastersRole: masterRole,                     // Grants this IAM role cluster-admin
      outputClusterName: true,                     // Export name to CloudFormation outputs
      endpointAccess: eks.EndpointAccess.PUBLIC_AND_PRIVATE, // API server reachable privately and publicly
      vpcSubnets: [{ subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS }], // Worker pods on private subnets
      kubectlLayer: new KubectlV32Layer(this, "kubectl"),  // Layer for kubectl execution at deploy time
      clusterLogging: [
        // Enable control plane logs to CloudWatch
        eks.ClusterLoggingTypes.API,
        eks.ClusterLoggingTypes.AUDIT,
        eks.ClusterLoggingTypes.AUTHENTICATOR,
        eks.ClusterLoggingTypes.CONTROLLER_MANAGER,
        eks.ClusterLoggingTypes.SCHEDULER,
      ],
    });

    // ---- IRSA (IAM Roles for Service Accounts) wiring ----
    const k8sAppNameSpace = "default";                 // App runs in default namespace
    const k8sAppServiceAccount = "agent-service-account";

    // CfnJson used to build StringEquals condition keys with OIDC issuer prefix.
    const conditions = new CfnJson(this, "ConditionJson", {
      value: {
        // OIDC 'aud' must be sts.amazonaws.com for AssumeRoleWithWebIdentity
        [`${cluster.clusterOpenIdConnectIssuer}:aud`]: "sts.amazonaws.com",
        // 'sub' must match the exact service account identity
        [`${cluster.clusterOpenIdConnectIssuer}:sub`]: `system:serviceaccount:${k8sAppNameSpace}:${k8sAppServiceAccount}`,
      },
    });

    // Federated principal for web identity (EKS OIDC provider) with our conditions above.
    const iamPrinciple = new iam.FederatedPrincipal(
      cluster.openIdConnectProvider.openIdConnectProviderArn,
      {},
      "sts:AssumeRoleWithWebIdentity"
    ).withConditions({ StringEquals: conditions });

    // This IAM role will be assumed by pods via the K8s service account (IRSA).
    const iamRoleForK8sSa = new iam.Role(this, "AgentServiceRole", {
      assumedBy: iamPrinciple,
    });

    // ---- Logs (application logs can also explicitly use LOG_GROUP env if needed) ----
    const logGroup = new logs.LogGroup(this, "AgentLogGroup", {
      logGroupName: `/aws/eks/${cluster.clusterName}/agent-service`, // App-specific group
      retention: logs.RetentionDays.INFINITE,                        // Keep forever (consider costs)
      removalPolicy: RemovalPolicy.DESTROY,
    });

    // ---- DynamoDB for feedback storage ----
    const feedbackTable = new dynamodb.Table(this, "FeedbackTable", {
      tableName: `iecho-feedback-table-${this.stackName}`, // Explicit name to export/use elsewhere
      partitionKey: { name: "feedbackId", type: dynamodb.AttributeType.STRING },
      timeToLiveAttribute: "ttl",                          // Optional TTL for auto-expiry of items
      removalPolicy: RemovalPolicy.DESTROY,                // Dev-friendly; for prod consider RETAIN
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,   // On-demand capacity
    });

    // ---- IAM permissions for the IRSA role used by the pods ----
    iamRoleForK8sSa.addToPrincipalPolicy(new iam.PolicyStatement({
      actions: [
        // Bedrock model + RAG/KB runtime access (streaming + retrieve)
        "bedrock:InvokeModel",
        "bedrock:InvokeModelWithResponseStream",
        "bedrock:RetrieveAndGenerate",
        "bedrock:Retrieve",
        "bedrock:GetInferenceProfile",

        // Bedrock Agent Runtime (if routing via an Agent)
        "bedrock-agent-runtime:Retrieve",
        "bedrock-agent-runtime:RetrieveAndGenerate",
      ],
      resources: ["*"], // Narrow to ARNs/models as you harden security
    }));
    iamRoleForK8sSa.addToPrincipalPolicy(new iam.PolicyStatement({
      // Read KB metadata and underlying S3 objects
      actions: ["bedrock:GetDataSource", "bedrock:ListDataSources", "s3:GetObject", "s3:ListBucket"],
      resources: ["*"],
    }));
    iamRoleForK8sSa.addToPrincipalPolicy(new iam.PolicyStatement({
      // Allow pods to write to CloudWatch Logs via fluent-bit/observability config
      actions: [
        "logs:CreateLogStream", 
        "logs:PutLogEvents", 
        "logs:DescribeLogGroups", 
        "logs:DescribeLogStreams",
        "logs:CreateLogGroup"
      ],
      resources: [
        logGroup.logGroupArn + ":*",                                         // App-specific group
        `arn:aws:logs:${this.region}:${this.account}:log-group:/aws/eks/${cluster.clusterName}/fargate:*` // Fargate default
      ],
    }));
    iamRoleForK8sSa.addToPrincipalPolicy(new iam.PolicyStatement({
      // Feedback write patterns; expand if reads/updates are needed
      actions: ["dynamodb:PutItem", "dynamodb:GetItem", "dynamodb:Query", "dynamodb:Scan"],
      resources: [feedbackTable.tableArn],
    }));

    // ---- Fargate profile (matches our app's namespace/labels) ----
    const fargateProfile = cluster.addFargateProfile("AgentProfile", {
      selectors: [{ namespace: k8sAppNameSpace, labels: { app: "agent-service" } }],
      subnetSelection: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
      fargateProfileName: "agent-profile",
    });

    // ---- Fluent Bit / aws-observability (EKS-on-Fargate logging to CloudWatch) ----
    const fargateLoggingConfigMap = {
      apiVersion: "v1",
      kind: "ConfigMap",
      metadata: {
        name: "aws-logging",
        namespace: "aws-observability",
      },
      data: {
        // Toggle CloudWatch output on
        "flb_log_cw": "true",
        // Fluent Bit filters: parse CRI logs, enrich with K8s metadata
        "filters.conf": `[FILTER]
    Name parser
    Match *
    Key_name log
    Parser cri
    Reserve_Data On
    Preserve_Key On

[FILTER]
    Name kubernetes
    Match kube.*
    Merge_Log On
    Keep_Log Off
    K8S-Logging.Parser On
    K8S-Logging.Exclude On`,
        // Send to CWL group with auto creation; use cluster-wide fargate log group
        "output.conf": `[OUTPUT]
    Name cloudwatch_logs
    Match *
    region ${this.region}
    log_group_name /aws/eks/${cluster.clusterName}/fargate
    log_stream_prefix fargate-
    auto_create_group On`,
        // Parser for CRI log format
        "parsers.conf": `[PARSER]
    Name cri
    Format regex
    Regex ^(?<time>[^ ]+) (?<stream>stdout|stderr) (?<logtag>[^ ]*) (?<log>.*)$
    Time_Key time
    Time_Format %Y-%m-%dT%H:%M:%S.%L%z`,
      },
    };

    // Namespace required by AWS Observability add-on (ConfigMap must live here).
    const observabilityNamespace = {
      apiVersion: "v1",
      kind: "Namespace",
      metadata: { name: "aws-observability" },
    };

    // Apply namespace first, then the ConfigMap (explicit dependency below).
    const observabilityNsManifest = cluster.addManifest("ObservabilityNamespace", observabilityNamespace);
    const fargateLoggingManifest = cluster.addManifest("FargateLoggingConfig", fargateLoggingConfigMap);
    fargateLoggingManifest.node.addDependency(observabilityNsManifest);

    // ---- External config/context: Knowledge Base ID ----
    // Allow overriding via `cdk deploy -c knowledgeBaseId=KBID`
    const knowledgeBaseId = this.node.tryGetContext("knowledgeBaseId") || "PLACEHOLDER";
    
    // ---- Optional: Document conversion Lambda (Office -> PDF) triggered by S3 uploads ----
    const documentsBucketName = this.node.tryGetContext("documentsBucketName");
    if (documentsBucketName) {
      // Reference an existing bucket by name (no new bucket created).
      const documentsBucket = s3.Bucket.fromBucketName(this, "DocumentsBucket", documentsBucketName);
      
      // Dedicated log group for the Lambda function.
      const lambdaLogGroup = new logs.LogGroup(this, "LambdaLogGroup", {
        logGroupName: `/aws/lambda/office-to-pdf-${this.stackName}`,
        retention: logs.RetentionDays.TWO_WEEKS,
        removalPolicy: RemovalPolicy.DESTROY
      });
      
      // Node.js function that bundles local code and uses a prebuilt LibreOffice layer.
      const officeToPdfLambda = new lambda.Function(this, "OfficeToPdfFunction", {
        runtime: lambda.Runtime.NODEJS_18_X,
        handler: "index.s3Handler", // Entry point export in index.js/ts
        code: lambda.Code.fromAsset(path.join(__dirname, "../lambda/office-to-pdf"), {
          bundling: {
            image: lambda.Runtime.NODEJS_18_X.bundlingImage,
            command: [
              'bash', '-c',
              'npm install && cp -r . /asset-output' // Simple copy; no transpile assumed
            ],
          },
        }),
        timeout: Duration.minutes(15),   // Long-running conversions for large docs
        memorySize: 1536,                // More RAM helps LibreOffice
        logGroup: lambdaLogGroup,
        layers: [
          // Public LibreOffice layer (Brotli-based). Ensure region/arch compatibility.
          lambda.LayerVersion.fromLayerVersionArn(
            this,
            "LibreOfficeLayer",
            `arn:aws:lambda:${this.region}:764866452798:layer:libreoffice-brotli:1`
          )
        ],
        environment: {
          BUCKET: documentsBucketName,   // Target bucket for outputs
          FONTCONFIG_PATH: "/var/task/fonts" // Optional: font discovery path
        }
      });
      
      // Grant the Lambda read/write/delete to handle in-place conversions.
      documentsBucket.grantReadWrite(officeToPdfLambda);
      documentsBucket.grantDelete(officeToPdfLambda);
      
      // Wire S3 event notifications to Lambda for common Office file types + PDFs (reprocess as needed).
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

    // ---- Application container image built from ../docker (published to ECR on synth/deploy) ----
    const dockerAsset = new ecrAssets.DockerImageAsset(this, "AgentImage", {
      directory: path.join(__dirname, "../docker"),
      platform: ecrAssets.Platform.LINUX_AMD64, // Ensures amd64 build; align with Fargate platform
    });

    // ---- AWS Load Balancer Controller service account (IRSA) ----
    // This SA will be bound to the Helm chart below (serviceAccount.create=false).
    const albServiceAccount = cluster.addServiceAccount("AWSLoadBalancerController", {
      name: "aws-load-balancer-controller",
      namespace: "kube-system",
    });

    // Broad permissions required by the controller to create/manage ALBs, target groups, SGs, etc.
    // For production, consider using the official AWS-managed IAM policy JSON.
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

    // ---- Install AWS Load Balancer Controller via Helm ----
    const albChart = cluster.addHelmChart("AWSLoadBalancerController", {
      chart: "aws-load-balancer-controller",
      repository: "https://aws.github.io/eks-charts",
      namespace: "kube-system",
      release: "aws-load-balancer-controller",
      version: "1.8.0",   // Match EKS version compatibility
      values: {
        clusterName: cluster.clusterName,
        serviceAccount: { create: false, name: "aws-load-balancer-controller" }, // Reuse SA above
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
    albChart.node.addDependency(albServiceAccount); // Ensure SA exists before Helm installs

    // ---- cdk8s chart: deploy K8s resources for the application ----
    const cdk8sApp = new cdk8s.App();
    const agentAppChart = new AgentAppChart(cdk8sApp, "agent-app", {
      iamRoleArn: iamRoleForK8sSa.roleArn,         // IRSA role for app pods
      namespace: k8sAppNameSpace,
      serviceAccountName: k8sAppServiceAccount,
      imageUri: dockerAsset.imageUri,              // Built asset URI
      knowledgeBaseId,
      region: this.region,
      accountId: this.account,
      logGroupName: logGroup.logGroupName,
      feedbackTableName: feedbackTable.tableName,
    });
    
    // Synthesize and apply chart resources to the cluster.
    const agentChart = cluster.addCdk8sChart("agent-app-chart", agentAppChart);

    // ---- Dependency ordering: ensure infra bits exist before app deploy ----
    agentChart.node.addDependency(fargateProfile); // Pods must match existing Fargate profile selectors
    agentChart.node.addDependency(albChart);       // ALB Controller must be ready to reconcile Ingress
    albChart.node.addDependency(cluster.awsAuth);  // Ensure awsAuth mapping ready

    // No finalizer removal on delete by default; ordering should prevent dangling resources.

    // ---- Safety: Patch ingress metadata on delete to help cleanup if needed ----
    const ingressFinalizerPatch = new KubernetesPatch(this, "IngressFinalizerPatch", {
      cluster,
      resourceName: "ingress/agent-ingress",
      resourceNamespace: k8sAppNameSpace,
      applyPatch: { metadata: { annotations: { "cdk.aws/finalizer-patch": "applied" } } }, // Marker annotation
      restorePatch: { metadata: { finalizers: [] } }, // Ensure no finalizers block deletion
    });
    ingressFinalizerPatch.node.addDependency(agentChart);

    // ---- Read ALB DNS once the Ingress is provisioned ----
    const albDnsProvider = new eks.KubernetesObjectValue(this, "AlbDnsProvider", {
      cluster,
      objectType: "ingress",
      objectName: "agent-ingress",
      objectNamespace: k8sAppNameSpace,
      jsonPath: ".status.loadBalancer.ingress[0].hostname", // ALB hostname surfaced by controller
    });
    albDnsProvider.node.addDependency(agentChart);

    // ---- API Gateway in front of ALB (handy for stable URL/CORS/usage plans) ----
    const api = new apigateway.RestApi(this, "AgentApi", {
      restApiName: "iECHO Agent API",
      description: "API Gateway for iECHO RAG Chatbot",
      defaultCorsPreflightOptions: {
        allowOrigins: apigateway.Cors.ALL_ORIGINS,
        allowMethods: apigateway.Cors.ALL_METHODS,
        allowHeaders: ["Content-Type", "X-Amz-Date", "Authorization", "X-Api-Key"],
      },
    });

    // Proxy ANY to ALB with greedy proxy resource. ALB DNS is read dynamically via K8s object value.
    const albIntegration = new apigateway.HttpIntegration(`http://${albDnsProvider.value}/{proxy}`, {
      httpMethod: "ANY",
      options: { requestParameters: { "integration.request.path.proxy": "method.request.path.proxy" } },
    });

    // Greedy proxy catches all paths and forwards to ALB.
    const proxyResource = api.root.addResource("{proxy+}");
    proxyResource.addMethod("ANY", albIntegration, { requestParameters: { "method.request.path.proxy": true } });

    // Root path also forwards to ALB (for e.g., "/")
    const rootIntegration = new apigateway.HttpIntegration(`http://${albDnsProvider.value}`, { httpMethod: "ANY" });
    api.root.addMethod("ANY", rootIntegration);
    
    // Ensure ALB DNS is resolvable before API methods are created.
    api.node.addDependency(albDnsProvider);

    // ---- Amplify App (manual zip deploy; no Git integration here) ----
    const amplifyApp = new amplify.CfnApp(this, "iECHOAmplifyApp", {
      name: "iECHO-RAG-Chatbot",
      description: "iECHO RAG Chatbot Frontend",
      platform: "WEB",
      // Simple Next.js build spec (adjust baseDirectory/files to your framework output)
      buildSpec: `version: 1
frontend:
  phases:
    preBuild:
      commands:
        - npm ci
    build:
      commands:
        - npm run build
  artifacts:
    baseDirectory: out
    files:
      - '**/*'
  cache:
    paths:
      - node_modules/**/*
      - .next/cache/**/*`,
      environmentVariables: [
        {
          // Expose the API base URL to the frontend at build time
          name: "NEXT_PUBLIC_API_BASE_URL",
          value: api.url
        }
      ]
    });

    // Note: Manual artifact upload to Amplify is expected (no repo connection defined).

    // ---- CloudFormation Outputs for convenience ----
    this.exportValue(api.url, { name: "ApiGatewayUrl", description: "The API Gateway URL" });
    this.exportValue(cluster.clusterName, { name: "AgentClusterName", description: "The name of the EKS cluster" });
    this.exportValue(cluster.clusterEndpoint, { name: "AgentClusterEndpoint", description: "The endpoint of the EKS cluster" });
    this.exportValue(masterRole.roleArn, { name: "ClusterMasterRoleArn", description: "The master role ARN for kubectl access" });
    this.exportValue(albDnsProvider.value, { name: "AlbDnsName", description: "The ALB DNS name" });
    this.exportValue(amplifyApp.attrDefaultDomain, { name: "AmplifyAppUrl", description: "The Amplify app URL" });
    this.exportValue(amplifyApp.attrAppId, { name: "AmplifyAppId", description: "The Amplify app ID" });
  }
}
