import { Stack, StackProps, Duration, RemovalPolicy, CfnJson, SecretValue } from "aws-cdk-lib";
import { Construct } from "constructs";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as eks from "aws-cdk-lib/aws-eks";
import * as iam from "aws-cdk-lib/aws-iam";
import * as logs from "aws-cdk-lib/aws-logs";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as apigateway from "aws-cdk-lib/aws-apigateway";
import * as ecrAssets from "aws-cdk-lib/aws-ecr-assets";
import * as amplify from "aws-cdk-lib/aws-amplify";



import * as path from "path";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as s3n from "aws-cdk-lib/aws-s3-notifications";
import { KubectlV32Layer } from "@aws-cdk/lambda-layer-kubectl-v32";
import { KubernetesPatch } from "aws-cdk-lib/aws-eks";

import * as cdk8s from "cdk8s";

interface AgentAppChartProps {
  iamRoleArn: string;
  namespace: string;
  serviceAccountName: string;
  imageUri: string;
  knowledgeBaseId: string;
  region: string;
  accountId: string;
  logGroupName: string;
  feedbackTableName: string;

}

class AgentAppChart extends cdk8s.Chart {
  constructor(scope: cdk8s.App, id: string, props: AgentAppChartProps) {
    super(scope, id, { namespace: props.namespace });

    // Service Account
    new cdk8s.ApiObject(this, "service-account", {
      apiVersion: "v1",
      kind: "ServiceAccount",
      metadata: {
        name: props.serviceAccountName,
        namespace: props.namespace,
        annotations: {
          "eks.amazonaws.com/role-arn": props.iamRoleArn
        }
      }
    });

    // Deployment
    new cdk8s.ApiObject(this, "deployment", {
      apiVersion: "apps/v1",
      kind: "Deployment",
      metadata: {
        name: "agent-service",
        namespace: props.namespace,
        labels: { app: "agent-service" }
      },
      spec: {
        replicas: 2,
        selector: { matchLabels: { app: "agent-service" } },
        template: {
          metadata: { labels: { app: "agent-service" } },
          spec: {
            serviceAccountName: props.serviceAccountName,
            containers: [{
              name: "agent-container",
              image: props.imageUri,
              ports: [{ containerPort: 8000 }],
              env: [
                { name: "KNOWLEDGE_BASE_ID", value: props.knowledgeBaseId },
                { name: "AWS_REGION", value: props.region },
                { name: "AWS_ACCOUNT_ID", value: props.accountId },
                { name: "LOG_GROUP", value: props.logGroupName },
                { name: "FEEDBACK_TABLE_NAME", value: props.feedbackTableName },

              ],
              resources: {
                requests: { memory: "512Mi", cpu: "500m" },
                limits: { memory: "1Gi", cpu: "1000m" }
              },
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

    // Service
    new cdk8s.ApiObject(this, "service", {
      apiVersion: "v1",
      kind: "Service",
      metadata: {
        name: "agent-service",
        namespace: props.namespace,
        labels: { app: "agent-service" }
      },
      spec: {
        type: "ClusterIP",
        ports: [{ port: 80, targetPort: 8000 }],
        selector: { app: "agent-service" }
      }
    });



    // Ingress
    new cdk8s.ApiObject(this, "ingress", {
      apiVersion: "networking.k8s.io/v1",
      kind: "Ingress",
      metadata: {
        name: "agent-ingress",
        namespace: props.namespace,
        annotations: {
          "alb.ingress.kubernetes.io/scheme": "internet-facing",
          "alb.ingress.kubernetes.io/target-type": "ip",
          "alb.ingress.kubernetes.io/healthcheck-path": "/health",
          "alb.ingress.kubernetes.io/load-balancer-attributes": "deletion_protection.enabled=false,idle_timeout.timeout_seconds=300",
          "alb.ingress.kubernetes.io/target-group-attributes": "deregistration_delay.timeout_seconds=30",
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
      clusterLogging: [
        eks.ClusterLoggingTypes.API,
        eks.ClusterLoggingTypes.AUDIT,
        eks.ClusterLoggingTypes.AUTHENTICATOR,
        eks.ClusterLoggingTypes.CONTROLLER_MANAGER,
        eks.ClusterLoggingTypes.SCHEDULER,
      ],
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
      retention: logs.RetentionDays.INFINITE,
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
      actions: [
        "logs:CreateLogStream", 
        "logs:PutLogEvents", 
        "logs:DescribeLogGroups", 
        "logs:DescribeLogStreams",
        "logs:CreateLogGroup"
      ],
      resources: [
        logGroup.logGroupArn + ":*",
        `arn:aws:logs:${this.region}:${this.account}:log-group:/aws/eks/${cluster.clusterName}/fargate:*`
      ],
    }));
    iamRoleForK8sSa.addToPrincipalPolicy(new iam.PolicyStatement({
      actions: ["dynamodb:PutItem", "dynamodb:GetItem", "dynamodb:Query", "dynamodb:Scan"],
      resources: [feedbackTable.tableArn],
    }));

    // Fargate profile with logging
    const fargateProfile = cluster.addFargateProfile("AgentProfile", {
      selectors: [{ namespace: k8sAppNameSpace, labels: { app: "agent-service" } }],
      subnetSelection: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
      fargateProfileName: "agent-profile",
    });

    // Fargate logging configuration
    const fargateLoggingConfigMap = {
      apiVersion: "v1",
      kind: "ConfigMap",
      metadata: {
        name: "aws-logging",
        namespace: "aws-observability",
      },
      data: {
        "flb_log_cw": "true",
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
        "output.conf": `[OUTPUT]
    Name cloudwatch_logs
    Match *
    region ${this.region}
    log_group_name /aws/eks/${cluster.clusterName}/fargate
    log_stream_prefix fargate-
    auto_create_group On`,
        "parsers.conf": `[PARSER]
    Name cri
    Format regex
    Regex ^(?<time>[^ ]+) (?<stream>stdout|stderr) (?<logtag>[^ ]*) (?<log>.*)$
    Time_Key time
    Time_Format %Y-%m-%dT%H:%M:%S.%L%z`,
      },
    };

    // Create aws-observability namespace
    const observabilityNamespace = {
      apiVersion: "v1",
      kind: "Namespace",
      metadata: { name: "aws-observability" },
    };

    const observabilityNsManifest = cluster.addManifest("ObservabilityNamespace", observabilityNamespace);
    const fargateLoggingManifest = cluster.addManifest("FargateLoggingConfig", fargateLoggingConfigMap);
    
    // Ensure namespace is created before ConfigMap
    fargateLoggingManifest.node.addDependency(observabilityNsManifest);

    // KB id
    const knowledgeBaseId = this.node.tryGetContext("knowledgeBaseId") || "PLACEHOLDER";
    


    // Optional: Office-to-PDF processor
    const documentsBucketName = this.node.tryGetContext("documentsBucketName");
    if (documentsBucketName) {
      const documentsBucket = s3.Bucket.fromBucketName(this, "DocumentsBucket", documentsBucketName);
      
      const lambdaLogGroup = new logs.LogGroup(this, "LambdaLogGroup", {
        logGroupName: `/aws/lambda/office-to-pdf-${this.stackName}`,
        retention: logs.RetentionDays.TWO_WEEKS,
        removalPolicy: RemovalPolicy.DESTROY
      });
      
      const officeToPdfLambda = new lambda.Function(this, "OfficeToPdfFunction", {
        runtime: lambda.Runtime.NODEJS_18_X,
        handler: "index.s3Handler",
        code: lambda.Code.fromAsset(path.join(__dirname, "../lambda/office-to-pdf"), {
          bundling: {
            image: lambda.Runtime.NODEJS_18_X.bundlingImage,
            command: [
              'bash', '-c',
              'npm install && cp -r . /asset-output'
            ],
          },
        }),
        timeout: Duration.minutes(15),
        memorySize: 1536,
        logGroup: lambdaLogGroup,
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



    // Use cdk8s for proper Kubernetes resource management
    const cdk8sApp = new cdk8s.App();
    const agentAppChart = new AgentAppChart(cdk8sApp, "agent-app", {
      iamRoleArn: iamRoleForK8sSa.roleArn,
      namespace: k8sAppNameSpace,
      serviceAccountName: k8sAppServiceAccount,
      imageUri: dockerAsset.imageUri,
      knowledgeBaseId,
      region: this.region,
      accountId: this.account,
      logGroupName: logGroup.logGroupName,
      feedbackTableName: feedbackTable.tableName,


    });
    
    const agentChart = cluster.addCdk8sChart("agent-app-chart", agentAppChart);

    // cdk8s chart dependencies
    agentChart.node.addDependency(fargateProfile);
    agentChart.node.addDependency(albChart);
    albChart.node.addDependency(cluster.awsAuth);

    // No finalizer patch needed - proper dependency ordering handles cleanup

    // Ingress finalizer patch for safer cleanup
    const ingressFinalizerPatch = new KubernetesPatch(this, "IngressFinalizerPatch", {
      cluster,
      resourceName: "ingress/agent-ingress",
      resourceNamespace: k8sAppNameSpace,
      applyPatch: { metadata: { annotations: { "cdk.aws/finalizer-patch": "applied" } } },
      restorePatch: { metadata: { finalizers: [] } },
    });
    ingressFinalizerPatch.node.addDependency(agentChart);

    // Get ALB hostname
    const albDnsProvider = new eks.KubernetesObjectValue(this, "AlbDnsProvider", {
      cluster,
      objectType: "ingress",
      objectName: "agent-ingress",
      objectNamespace: k8sAppNameSpace,
      jsonPath: ".status.loadBalancer.ingress[0].hostname",
    });
    albDnsProvider.node.addDependency(agentChart);

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
    
    api.node.addDependency(albDnsProvider);

    // Amplify App with GitHub App integration
    const amplifyApp = new amplify.CfnApp(this, "iECHOAmplifyApp", {
      name: "iECHO-RAG-Chatbot",
      description: "iECHO RAG Chatbot Frontend",
      repository: `https://github.com/${this.node.tryGetContext("githubOwner") || "ASUCICREPO"}/${this.node.tryGetContext("githubRepo") || "IECHO-RAG-CHATBOT"}`,
      accessToken: SecretValue.secretsManager("github-access-token").unsafeUnwrap(),
      platform: "WEB",
      buildSpec: `version: 1
frontend:
  phases:
    preBuild:
      commands:
        - cd frontend
        - npm ci
    build:
      commands:
        - npm run build
  artifacts:
    baseDirectory: frontend/out
    files:
      - '**/*'
  cache:
    paths:
      - frontend/node_modules/**/*
      - frontend/.next/cache/**/*`,
      environmentVariables: [
        {
          name: "NEXT_PUBLIC_API_BASE_URL",
          value: api.urlForPath('')
        }
      ]
    });

    // Create branch for auto-build
    const fullCdkBranch = new amplify.CfnBranch(this, "FullCdkBranch", {
      appId: amplifyApp.attrAppId,
      branchName: "full-cdk",
      enableAutoBuild: true,
      stage: "PRODUCTION"
    });

    // Note: Repository connection via GitHub App must be done manually in Amplify console

    // Outputs
    this.exportValue(api.urlForPath(''), { name: "ApiGatewayUrl", description: "The API Gateway URL" });
    this.exportValue(cluster.clusterName, { name: "AgentClusterName", description: "The name of the EKS cluster" });
    this.exportValue(cluster.clusterEndpoint, { name: "AgentClusterEndpoint", description: "The endpoint of the EKS cluster" });
    this.exportValue(masterRole.roleArn, { name: "ClusterMasterRoleArn", description: "The master role ARN for kubectl access" });
    this.exportValue(albDnsProvider.value, { name: "AlbDnsName", description: "The ALB DNS name" });
    this.exportValue(amplifyApp.attrDefaultDomain, { name: "AmplifyAppUrl", description: "The Amplify app URL" });
    this.exportValue(amplifyApp.attrAppId, { name: "AmplifyAppId", description: "The Amplify app ID" });
    
    // ALB hostname available via: kubectl get ingress agent-ingress -o jsonpath='{.status.loadBalancer.ingress[0].hostname}'
    
    // Note: Use ./destroy.sh script for reliable cleanup
    // - Script cleans up k8s security groups before CDK destroy
    // - Prevents VPC deletion failures
  }
}
