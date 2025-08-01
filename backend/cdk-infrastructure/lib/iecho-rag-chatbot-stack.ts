import * as cdk from 'aws-cdk-lib';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as s3n from 'aws-cdk-lib/aws-s3-notifications';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as apigatewayv2 from 'aws-cdk-lib/aws-apigatewayv2';
import * as apigatewayv2_integrations from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as eks from 'aws-cdk-lib/aws-eks';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import * as bedrock from 'aws-cdk-lib/aws-bedrock';
import { Construct } from 'constructs';
import { NagSuppressions } from 'cdk-nag';

// GenAI CDK Constructs for enhanced features
import * as genai from '@cdklabs/generative-ai-cdk-constructs';

export class IEchoRagChatbotStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // ========================================
    // 1. STORAGE LAYER
    // ========================================

    // Document storage bucket for uploaded files
    const documentBucket = new s3.Bucket(this, 'DocumentBucket', {
      bucketName: `iecho-documents-${this.account}-${this.region}`,
      versioned: true,
      encryption: s3.BucketEncryption.S3_MANAGED,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      removalPolicy: cdk.RemovalPolicy.DESTROY, // For development
      autoDeleteObjects: true, // For development
      lifecycleRules: [{
        id: 'DeleteIncompleteMultipartUploads',
        abortIncompleteMultipartUploadAfter: cdk.Duration.days(7),
      }],
    });

    // Note: Vector storage is handled automatically by Bedrock when using S3 Vectors
    // Bedrock creates and manages its own S3 bucket for vector storage

    // DynamoDB table for user feedback and response ratings
    const feedbackTable = new dynamodb.Table(this, 'FeedbackTable', {
      tableName: 'iecho-user-feedback',
      partitionKey: { name: 'userId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'timestamp', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      encryption: dynamodb.TableEncryption.AWS_MANAGED,
      pointInTimeRecovery: true,
      removalPolicy: cdk.RemovalPolicy.DESTROY, // For development
    });

    // Add GSI for querying by response ID
    feedbackTable.addGlobalSecondaryIndex({
      indexName: 'ResponseIdIndex',
      partitionKey: { name: 'responseId', type: dynamodb.AttributeType.STRING },
    });

    // ========================================
    // 2. IAM ROLES FOR BEDROCK KNOWLEDGE BASE
    // ========================================

    // Create IAM role for Bedrock Knowledge Base
    const knowledgeBaseRole = new iam.Role(this, 'KnowledgeBaseRole', {
      assumedBy: new iam.ServicePrincipal('bedrock.amazonaws.com'),
      inlinePolicies: {
        BedrockKnowledgeBasePolicy: new iam.PolicyDocument({
          statements: [
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: [
                'bedrock:InvokeModel',
                'bedrock:InvokeModelWithResponseStream',
              ],
              resources: [
                `arn:aws:bedrock:${this.region}::foundation-model/amazon.titan-embed-text-v2:0`,
              ],
            }),
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: [
                's3:GetObject',
                's3:ListBucket',
                's3:PutObject',
                's3:DeleteObject',
              ],
              resources: [
                documentBucket.bucketArn,
                `${documentBucket.bucketArn}/*`,
              ],
            }),
            // S3 Vectors permissions for Knowledge Base storage
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: [
                's3vectors:*', // Grant all S3 Vectors permissions to avoid missing any
              ],
              resources: [
                `arn:aws:s3vectors:${this.region}:${this.account}:bucket/bedrock-knowledge-base-*`,
                `arn:aws:s3vectors:${this.region}:${this.account}:bucket/bedrock-knowledge-base-*/index/*`,
              ],
            }),
            // Additional S3 permissions for Bedrock-managed buckets
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: [
                's3:GetObject',
                's3:PutObject',
                's3:DeleteObject',
                's3:ListBucket',
                's3:GetBucketLocation',
                's3:GetBucketVersioning',
                's3:ListBucketVersions',
              ],
              resources: [
                `arn:aws:s3:::bedrock-knowledge-base-*`,
                `arn:aws:s3:::bedrock-knowledge-base-*/*`,
              ],
            }),
          ],
        }),
      },
    });

    // Note: Vector storage is handled by Bedrock when using S3 Vectors
    // Bedrock automatically creates and manages its own S3 bucket for vector storage

    // ========================================
    // 4. BEDROCK KNOWLEDGE BASE (Created manually via AWS Console)
    // ========================================
    
    // Note: Knowledge Base with S3 Vectors will be created via AWS CLI
    // since CloudFormation doesn't support S3_VECTORS type yet
    
    // We'll create placeholder values that will be replaced by CLI outputs
    const knowledgeBaseId = 'PLACEHOLDER_KB_ID'; // Will be set by deployment script
    const dataSourceId = 'PLACEHOLDER_DS_ID';   // Will be set by deployment script

    // ========================================
    // 5. LAMBDA LAYERS
    // ========================================

    // Create Lambda layer for document processing dependencies
    const documentProcessingLayer = new lambda.LayerVersion(this, 'DocumentProcessingLayer', {
      layerVersionName: 'iecho-document-processing-layer',
      code: lambda.Code.fromAsset('lambda-layers/document-processing'),
      compatibleRuntimes: [lambda.Runtime.PYTHON_3_11],
      description: 'Python libraries for document processing (python-pptx, reportlab, PyPDF2, etc.)',
    });

    // ========================================
    // 6. LAMBDA FUNCTIONS
    // ========================================

    // Document processing Lambda (PPT to PDF conversion)
    const documentProcessorLambda = new lambda.Function(this, 'DocumentProcessor', {
      functionName: 'iecho-document-processor',
      runtime: lambda.Runtime.PYTHON_3_11,
      handler: 'index.handler',
      code: lambda.Code.fromAsset('lambda-functions/document-processor'),
      layers: [documentProcessingLayer],
      timeout: cdk.Duration.minutes(15),
      memorySize: 2048,
      environment: {
        KNOWLEDGE_BASE_ID: knowledgeBaseId, // Will be updated by deployment script
        DATA_SOURCE_ID: dataSourceId,       // Will be updated by deployment script
      },
      logRetention: logs.RetentionDays.ONE_WEEK,
    });

    // Grant permissions to document processor
    documentBucket.grantReadWrite(documentProcessorLambda);
    
    documentProcessorLambda.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'bedrock:StartIngestionJob',
        'bedrock:GetIngestionJob',
        'bedrock:ListIngestionJobs',
        'bedrock:GetKnowledgeBase',
      ],
      resources: [
        `arn:aws:bedrock:${this.region}:${this.account}:knowledge-base/*`, // Allow access to any KB
        `arn:aws:bedrock:${this.region}:${this.account}:knowledge-base/*/data-source/*`, // Allow access to any data source
      ],
    }));

    // ========================================
    // 7. SIMPLIFIED EKS CLUSTER (NO NAT GATEWAY)
    // ========================================

    // Create VPC with private subnets and VPC endpoints for cost-effective Fargate deployment
    const vpc = new ec2.Vpc(this, 'EksVpc', {
      maxAzs: 2,
      natGateways: 0, // No NAT Gateway to save costs - use VPC endpoints instead
      subnetConfiguration: [
        {
          cidrMask: 24,
          name: 'Public',
          subnetType: ec2.SubnetType.PUBLIC,
        },
        {
          cidrMask: 24,
          name: 'Private',
          subnetType: ec2.SubnetType.PRIVATE_ISOLATED, // Truly private subnets for Fargate
        },
      ],
    });

    // Add VPC endpoints for Fargate to access AWS services without NAT Gateway
    // This is much cheaper than NAT Gateway (~$7/month vs ~$45/month)
    vpc.addGatewayEndpoint('S3Endpoint', {
      service: ec2.GatewayVpcEndpointAwsService.S3,
      subnets: [{ subnetType: ec2.SubnetType.PRIVATE_ISOLATED }],
    });

    vpc.addInterfaceEndpoint('EcrApiEndpoint', {
      service: ec2.InterfaceVpcEndpointAwsService.ECR,
      subnets: { subnetType: ec2.SubnetType.PRIVATE_ISOLATED },
    });

    vpc.addInterfaceEndpoint('EcrDkrEndpoint', {
      service: ec2.InterfaceVpcEndpointAwsService.ECR_DOCKER,
      subnets: { subnetType: ec2.SubnetType.PRIVATE_ISOLATED },
    });

    vpc.addInterfaceEndpoint('CloudWatchLogsEndpoint', {
      service: ec2.InterfaceVpcEndpointAwsService.CLOUDWATCH_LOGS,
      subnets: { subnetType: ec2.SubnetType.PRIVATE_ISOLATED },
    });

    // Create EKS cluster with private subnet configuration
    const cluster = new eks.Cluster(this, 'EksCluster', {
      clusterName: 'iecho-agent-cluster',
      version: eks.KubernetesVersion.V1_31,
      vpc,
      defaultCapacity: 0, // We'll use Fargate
      endpointAccess: eks.EndpointAccess.PUBLIC, // Control plane accessible from internet
      // Use private subnets for the cluster (required for Fargate)
      vpcSubnets: [{ subnetType: ec2.SubnetType.PRIVATE_ISOLATED }],
    });

    // Add Fargate profile for agents (use private subnets as required by AWS)
    cluster.addFargateProfile('AgentProfile', {
      selectors: [
        { namespace: 'iecho-agents' },
      ],
      fargateProfileName: 'iecho-agents-profile',
      // Use private subnets for Fargate (AWS requirement)
      vpc: vpc,
      subnetSelection: { subnetType: ec2.SubnetType.PRIVATE_ISOLATED },
    });

    // Create namespace for agents
    const agentNamespace = cluster.addManifest('AgentNamespace', {
      apiVersion: 'v1',
      kind: 'Namespace',
      metadata: {
        name: 'iecho-agents',
      },
    });

    // Create service account with IRSA (IAM Roles for Service Accounts)
    const agentServiceAccount = cluster.addServiceAccount('AgentServiceAccount', {
      name: 'iecho-agent-service-account',
      namespace: 'iecho-agents',
    });
    
    // Grant the service account the necessary permissions
    feedbackTable.grantReadWriteData(agentServiceAccount);
    documentBucket.grantRead(agentServiceAccount);
    
    agentServiceAccount.addToPrincipalPolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'bedrock:InvokeModel',
        'bedrock:RetrieveAndGenerate',
        'bedrock:Retrieve',
        'bedrock:GetKnowledgeBase',
        'bedrock:StartIngestionJob',
        'bedrock:GetIngestionJob',
        'bedrock:ListIngestionJobs',
      ],
      resources: ['*'],
    }));

    // Create ConfigMap for agent configuration (depends on namespace)
    const agentConfigMap = cluster.addManifest('AgentConfigMap', {
      apiVersion: 'v1',
      kind: 'ConfigMap',
      metadata: {
        name: 'iecho-config',
        namespace: 'iecho-agents',
      },
      data: {
        'knowledge-base-id': knowledgeBaseId, // Will be updated by deployment script
        'feedback-table': feedbackTable.tableName,
        'document-bucket': documentBucket.bucketName,
        'data-source-id': dataSourceId,       // Will be updated by deployment script
        'aws-region': this.region,
      },
    });
    agentConfigMap.node.addDependency(agentNamespace);

    // Create ConfigMap with Strands SDK agent application code (depends on namespace)
    const agentCodeConfigMap = cluster.addManifest('AgentCodeConfigMap', {
      apiVersion: 'v1',
      kind: 'ConfigMap',
      metadata: {
        name: 'iecho-agent-code',
        namespace: 'iecho-agents',
      },
      data: {
        'app.py': `
import os
import json
import logging
from typing import Dict, Any, List, Optional
from datetime import datetime
import boto3
from flask import Flask, request, jsonify
import uuid
import time

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Initialize Flask app
app = Flask(__name__)

# Initialize AWS clients
bedrock_runtime = boto3.client('bedrock-agent-runtime')
dynamodb = boto3.resource('dynamodb')
s3_client = boto3.client('s3')

class StrandsOrchestrator:
    """Strands SDK-based orchestrator for RAG operations - Always running, no cold starts"""
    
    def __init__(self):
        self.knowledge_base_id = os.environ.get('KNOWLEDGE_BASE_ID')
        self.feedback_table = os.environ.get('FEEDBACK_TABLE')
        self.document_bucket = os.environ.get('DOCUMENT_BUCKET')
        logger.info(f"Strands Orchestrator initialized with KB: {self.knowledge_base_id}")
        
    def process_chat_request(self, query: str, user_id: str, session_id: str = None) -> Dict[str, Any]:
        """Process chat request - optimized for 24/7 operation"""
        try:
            session_id = session_id or str(uuid.uuid4())
            
            logger.info(f"Processing chat request for user {user_id}: {query[:100]}...")
            
            # Direct Bedrock Knowledge Base query (no cold start delay)
            response = bedrock_runtime.retrieve_and_generate(
                input={'text': query},
                retrieveAndGenerateConfiguration={
                    'type': 'KNOWLEDGE_BASE',
                    'knowledgeBaseConfiguration': {
                        'knowledgeBaseId': self.knowledge_base_id,
                        'modelArn': f"arn:aws:bedrock:{os.environ.get('AWS_REGION')}::foundation-model/amazon.nova-lite-v1:0",
                        'retrievalConfiguration': {
                            'vectorSearchConfiguration': {
                                'numberOfResults': 10,
                                'overrideSearchType': 'HYBRID'
                            }
                        },
                        'generationConfiguration': {
                            'inferenceConfig': {
                                'textInferenceConfig': {
                                    'temperature': 0.1,
                                    'topP': 0.9,
                                    'maxTokens': 2048
                                }
                            }
                        }
                    }
                }
            )
            
            ai_response = response.get('output', {}).get('text', '')
            citations = self._process_citations(response.get('citations', []))
            response_id = str(uuid.uuid4())
            
            # Log interaction asynchronously
            self._log_interaction(user_id, session_id, query, ai_response, response_id)
            
            return {
                'status': 'success',
                'response': ai_response,
                'citations': citations,
                'sessionId': response.get('sessionId', session_id),
                'responseId': response_id,
                'userId': user_id,
                'timestamp': datetime.now().isoformat()
            }
            
        except Exception as e:
            logger.error(f"Error in chat processing: {str(e)}")
            return {
                'status': 'error',
                'error': str(e),
                'sessionId': session_id,
                'userId': user_id
            }
    
    def _process_citations(self, citations: List[Dict]) -> List[Dict]:
        """Process and format citations"""
        processed_citations = []
        
        for i, citation in enumerate(citations):
            citation_data = {
                'id': str(i + 1),
                'title': '',
                'source': '',
                'excerpt': '',
                'confidence': None
            }
            
            if 'retrievedReferences' in citation:
                for ref in citation['retrievedReferences']:
                    if 'location' in ref and 's3Location' in ref['location']:
                        s3_location = ref['location']['s3Location']
                        source_uri = s3_location.get('uri', '')
                        citation_data['source'] = source_uri.split('/')[-1] if '/' in source_uri else source_uri
                    
                    if 'content' in ref:
                        content = ref['content']
                        text = content.get('text', '')
                        citation_data['excerpt'] = text[:300] + '...' if len(text) > 300 else text
                    
                    if 'metadata' in ref:
                        metadata = ref['metadata']
                        citation_data['title'] = metadata.get('title', citation_data['source'])
                    
                    if 'score' in ref:
                        citation_data['confidence'] = round(ref['score'], 3)
            
            if citation_data['excerpt'] or citation_data['source']:
                processed_citations.append(citation_data)
        
        return processed_citations
    
    def _log_interaction(self, user_id: str, session_id: str, query: str, response: str, response_id: str):
        """Log interaction for analytics"""
        try:
            table = dynamodb.Table(self.feedback_table)
            timestamp = str(int(time.time()))
            
            # Log user query
            table.put_item(Item={
                'userId': user_id,
                'timestamp': timestamp + '_query',
                'sessionId': session_id,
                'interactionType': 'request',
                'content': query[:1000],
                'createdAt': datetime.now().isoformat()
            })
            
            # Log assistant response
            table.put_item(Item={
                'userId': user_id,
                'timestamp': timestamp + '_response',
                'sessionId': session_id,
                'responseId': response_id,
                'interactionType': 'response',
                'content': response[:1000],
                'createdAt': datetime.now().isoformat()
            })
                
        except Exception as e:
            logger.warning(f"Failed to log interaction: {str(e)}")

# Initialize orchestrator (runs once on container start)
orchestrator = StrandsOrchestrator()

# Flask routes
@app.route('/health', methods=['GET'])
def health_check():
    return jsonify({
        'status': 'healthy',
        'service': 'iECHO RAG Agent (Strands SDK - Always Running)',
        'timestamp': datetime.now().isoformat(),
        'knowledge_base_id': os.environ.get('KNOWLEDGE_BASE_ID', 'not_configured'),
        'uptime': 'Always running - no cold starts'
    })

@app.route('/chat', methods=['POST'])
def chat():
    try:
        data = request.get_json()
        
        if not data or not data.get('query'):
            return jsonify({'status': 'error', 'error': 'Query is required'}), 400
        
        result = orchestrator.process_chat_request(
            query=data['query'],
            user_id=data.get('userId', 'anonymous'),
            session_id=data.get('sessionId')
        )
        
        if result['status'] == 'success':
            return jsonify(result)
        else:
            return jsonify(result), 500
            
    except Exception as e:
        logger.error(f"Error in chat endpoint: {str(e)}")
        return jsonify({'status': 'error', 'error': str(e)}), 500

@app.route('/feedback', methods=['POST'])
def feedback():
    try:
        data = request.get_json()
        
        if not data or not data.get('responseId') or not data.get('rating'):
            return jsonify({'status': 'error', 'error': 'responseId and rating are required'}), 400
        
        table = dynamodb.Table(os.environ.get('FEEDBACK_TABLE'))
        timestamp = str(int(time.time()))
        
        table.put_item(Item={
            'userId': data.get('userId', 'anonymous'),
            'timestamp': timestamp,
            'responseId': data['responseId'],
            'rating': int(data['rating']),
            'feedback': data.get('feedback', ''),
            'createdAt': datetime.now().isoformat(),
            'interactionType': 'feedback'
        })
        
        return jsonify({
            'status': 'success',
            'message': 'Feedback saved successfully',
            'feedback_id': f"{data.get('userId', 'anonymous')}#{timestamp}"
        })
        
    except Exception as e:
        logger.error(f"Error in feedback endpoint: {str(e)}")
        return jsonify({'status': 'error', 'error': str(e)}), 500

@app.route('/documents', methods=['GET'])
def documents():
    try:
        bucket_name = os.environ.get('DOCUMENT_BUCKET')
        response = s3_client.list_objects_v2(Bucket=bucket_name, Prefix='processed/', MaxKeys=50)
        
        documents = []
        if 'Contents' in response:
            for obj in response['Contents']:
                if not obj['Key'].endswith('/'):
                    documents.append({
                        'key': obj['Key'],
                        'name': obj['Key'].split('/')[-1],
                        'size': obj['Size'],
                        'lastModified': obj['LastModified'].isoformat()
                    })
        
        return jsonify({
            'status': 'success',
            'documents': documents,
            'count': len(documents)
        })
        
    except Exception as e:
        logger.error(f"Error listing documents: {str(e)}")
        return jsonify({'status': 'error', 'error': str(e)}), 500

if __name__ == '__main__':
    port = int(os.environ.get('PORT', 8080))
    logger.info(f"Starting Strands SDK Agent on port {port} - Always running, no cold starts!")
    app.run(host='0.0.0.0', port=port, debug=False)
        `,
        'requirements.txt': `
flask==3.0.0
boto3==1.34.0
botocore==1.34.0
gunicorn==21.2.0
requests==2.31.0
        `
      },
    });
    agentCodeConfigMap.node.addDependency(agentNamespace);

    // Deploy the Strands SDK agent as Fargate task (always running) (depends on namespace and configmaps)
    const agentDeployment = cluster.addManifest('AgentDeployment', {
      apiVersion: 'apps/v1',
      kind: 'Deployment',
      metadata: {
        name: 'iecho-rag-agent',
        namespace: 'iecho-agents',
        labels: {
          app: 'iecho-rag-agent',
        },
      },
      spec: {
        replicas: 2, // Always running - no cold starts
        selector: {
          matchLabels: {
            app: 'iecho-rag-agent',
          },
        },
        template: {
          metadata: {
            labels: {
              app: 'iecho-rag-agent',
            },
          },
          spec: {
            serviceAccountName: 'iecho-agent-service-account',
            containers: [
              {
                name: 'rag-agent',
                image: 'python:3.11-slim',
                ports: [
                  {
                    containerPort: 8080,
                  },
                ],
                env: [
                  {
                    name: 'KNOWLEDGE_BASE_ID',
                    valueFrom: {
                      configMapKeyRef: {
                        name: 'iecho-config',
                        key: 'knowledge-base-id',
                      },
                    },
                  },
                  {
                    name: 'FEEDBACK_TABLE',
                    valueFrom: {
                      configMapKeyRef: {
                        name: 'iecho-config',
                        key: 'feedback-table',
                      },
                    },
                  },
                  {
                    name: 'DOCUMENT_BUCKET',
                    valueFrom: {
                      configMapKeyRef: {
                        name: 'iecho-config',
                        key: 'document-bucket',
                      },
                    },
                  },
                  {
                    name: 'AWS_REGION',
                    valueFrom: {
                      configMapKeyRef: {
                        name: 'iecho-config',
                        key: 'aws-region',
                      },
                    },
                  },
                  {
                    name: 'PORT',
                    value: '8080',
                  },
                ],
                command: ['/bin/bash'],
                args: [
                  '-c',
                  `
                  pip install --no-cache-dir -r /app/requirements.txt && 
                  python /app/app.py
                  `,
                ],
                volumeMounts: [
                  {
                    name: 'app-code',
                    mountPath: '/app',
                  },
                ],
                resources: {
                  requests: {
                    memory: '512Mi',
                    cpu: '250m',
                  },
                  limits: {
                    memory: '1Gi',
                    cpu: '500m',
                  },
                },
                livenessProbe: {
                  httpGet: {
                    path: '/health',
                    port: 8080,
                  },
                  initialDelaySeconds: 60,
                  periodSeconds: 30,
                },
                readinessProbe: {
                  httpGet: {
                    path: '/health',
                    port: 8080,
                  },
                  initialDelaySeconds: 30,
                  periodSeconds: 10,
                },
              },
            ],
            volumes: [
              {
                name: 'app-code',
                configMap: {
                  name: 'iecho-agent-code',
                },
              },
            ],
          },
        },
      },
    });
    agentDeployment.node.addDependency(agentNamespace);
    agentDeployment.node.addDependency(agentConfigMap);
    agentDeployment.node.addDependency(agentCodeConfigMap);

    // Create ClusterIP service for ALB integration (depends on namespace)
    const agentService = cluster.addManifest('AgentService', {
      apiVersion: 'v1',
      kind: 'Service',
      metadata: {
        name: 'iecho-rag-agent-service',
        namespace: 'iecho-agents',
      },
      spec: {
        selector: {
          app: 'iecho-rag-agent',
        },
        ports: [
          {
            protocol: 'TCP',
            port: 80,
            targetPort: 8080,
          },
        ],
        type: 'ClusterIP',
      },
    });
    agentService.node.addDependency(agentNamespace);

    // Application Load Balancer (as per architecture description)
    const alb = new elbv2.ApplicationLoadBalancer(this, 'AgentALB', {
      vpc,
      internetFacing: true, // Public ALB for API Gateway integration
      loadBalancerName: 'iecho-agent-alb',
      vpcSubnets: { subnetType: ec2.SubnetType.PUBLIC },
    });

    // Create target group for ALB
    const targetGroup = new elbv2.ApplicationTargetGroup(this, 'AgentTargetGroup', {
      port: 80,
      vpc,
      protocol: elbv2.ApplicationProtocol.HTTP,
      targetType: elbv2.TargetType.IP,
      healthCheck: {
        enabled: true,
        path: '/health',
        protocol: elbv2.Protocol.HTTP,
        healthyHttpCodes: '200',
        interval: cdk.Duration.seconds(30),
        timeout: cdk.Duration.seconds(5),
        healthyThresholdCount: 2,
        unhealthyThresholdCount: 3,
      },
    });

    // Add listener to ALB
    const listener = alb.addListener('AgentListener', {
      port: 80,
      protocol: elbv2.ApplicationProtocol.HTTP,
      defaultTargetGroups: [targetGroup],
    });

    // Note: Target registration will be handled by AWS Load Balancer Controller
    // which needs to be installed in the EKS cluster

    // ========================================
    // 8. API GATEWAY WITH ALB INTEGRATION
    // ========================================

    // Create VPC Link v2 for ALB integration (HTTP API supports ALB natively)
    const vpcLink = new apigatewayv2.VpcLink(this, 'AgentVpcLink', {
      vpc,
      subnets: { subnetType: ec2.SubnetType.PUBLIC }, // Use public subnets since we have no NAT Gateway
      vpcLinkName: 'iecho-agent-vpc-link',
    });

    // Create HTTP API Gateway v2 for ALB integration
    const httpApi = new apigatewayv2.HttpApi(this, 'AgentHttpApi', {
      apiName: 'iecho-agent-http-api',
      description: 'HTTP API for iECHO RAG Agent with ALB integration',
      corsPreflight: {
        allowOrigins: ['*'],
        allowMethods: [apigatewayv2.CorsHttpMethod.ANY],
        allowHeaders: ['Content-Type', 'X-Amz-Date', 'Authorization', 'X-Api-Key'],
      },
    });

    // Create ALB integration for HTTP API
    const albIntegration = new apigatewayv2_integrations.HttpAlbIntegration(
      'AlbIntegration',
      listener,
      {
        vpcLink,
      }
    );

    // Add routes to HTTP API - using proxy route for all endpoints
    new apigatewayv2.HttpRoute(this, 'ProxyRoute', {
      httpApi,
      routeKey: apigatewayv2.HttpRouteKey.with('/{proxy+}', apigatewayv2.HttpMethod.ANY),
      integration: albIntegration,
    });

    // Add specific routes for better documentation and routing
    new apigatewayv2.HttpRoute(this, 'ChatRoute', {
      httpApi,
      routeKey: apigatewayv2.HttpRouteKey.with('/chat', apigatewayv2.HttpMethod.POST),
      integration: albIntegration,
    });

    new apigatewayv2.HttpRoute(this, 'FeedbackRoute', {
      httpApi,
      routeKey: apigatewayv2.HttpRouteKey.with('/feedback', apigatewayv2.HttpMethod.POST),
      integration: albIntegration,
    });

    new apigatewayv2.HttpRoute(this, 'HealthRoute', {
      httpApi,
      routeKey: apigatewayv2.HttpRouteKey.with('/health', apigatewayv2.HttpMethod.GET),
      integration: albIntegration,
    });

    new apigatewayv2.HttpRoute(this, 'DocumentsRoute', {
      httpApi,
      routeKey: apigatewayv2.HttpRouteKey.with('/documents', apigatewayv2.HttpMethod.GET),
      integration: albIntegration,
    });

    // ========================================
    // 9. S3 TRIGGER FOR DOCUMENT PROCESSING
    // ========================================

    // Create S3 event notifications for document processing
    documentBucket.addEventNotification(
      s3.EventType.OBJECT_CREATED,
      new s3n.LambdaDestination(documentProcessorLambda),
      { prefix: 'uploads/', suffix: '.pdf' }
    );
    
    documentBucket.addEventNotification(
      s3.EventType.OBJECT_CREATED,
      new s3n.LambdaDestination(documentProcessorLambda),
      { prefix: 'uploads/', suffix: '.ppt' }
    );
    
    documentBucket.addEventNotification(
      s3.EventType.OBJECT_CREATED,
      new s3n.LambdaDestination(documentProcessorLambda),
      { prefix: 'uploads/', suffix: '.pptx' }
    );
    
    documentBucket.addEventNotification(
      s3.EventType.OBJECT_CREATED,
      new s3n.LambdaDestination(documentProcessorLambda),
      { prefix: 'uploads/', suffix: '.doc' }
    );
    
    documentBucket.addEventNotification(
      s3.EventType.OBJECT_CREATED,
      new s3n.LambdaDestination(documentProcessorLambda),
      { prefix: 'uploads/', suffix: '.docx' }
    );

    // ========================================
    // 10. OUTPUTS
    // ========================================

    new cdk.CfnOutput(this, 'HttpApiGatewayUrl', {
      value: httpApi.url!,
      description: 'HTTP API Gateway URL (Routes via VPC Link → ALB → EKS Fargate Agent)',
    });

    new cdk.CfnOutput(this, 'ApplicationLoadBalancerDns', {
      value: alb.loadBalancerDnsName,
      description: 'Application Load Balancer DNS name',
    });

    new cdk.CfnOutput(this, 'EksClusterName', {
      value: cluster.clusterName,
      description: 'EKS cluster name for always-running Strands SDK agents',
    });

    new cdk.CfnOutput(this, 'VpcLinkId', {
      value: vpcLink.vpcLinkId,
      description: 'VPC Link ID for API Gateway → ALB integration',
    });

    new cdk.CfnOutput(this, 'DocumentBucketName', {
      value: documentBucket.bucketName,
      description: 'S3 bucket for document uploads',
    });

    new cdk.CfnOutput(this, 'KnowledgeBaseRoleArn', {
      value: knowledgeBaseRole.roleArn,
      description: 'IAM Role ARN for Bedrock Knowledge Base (for manual creation)',
    });

    new cdk.CfnOutput(this, 'DocumentBucketArn', {
      value: documentBucket.bucketArn,
      description: 'S3 Document Bucket ARN (for Data Source creation)',
    });

    new cdk.CfnOutput(this, 'FeedbackTableName', {
      value: feedbackTable.tableName,
      description: 'DynamoDB table for user feedback',
    });

    new cdk.CfnOutput(this, 'DocumentProcessingLayerArn', {
      value: documentProcessingLayer.layerVersionArn,
      description: 'Lambda layer ARN for document processing',
    });

    // ========================================
    // 11. CDK NAG SUPPRESSIONS
    // ========================================

    // Suppress CDK Nag warnings for development environment
    NagSuppressions.addStackSuppressions(this, [
      {
        id: 'AwsSolutions-IAM4',
        reason: 'AWS managed policies are acceptable for this demo application',
      },
      {
        id: 'AwsSolutions-IAM5',
        reason: 'Wildcard permissions needed for Bedrock model access',
      },
      {
        id: 'AwsSolutions-APIG2',
        reason: 'Request validation will be implemented in production',
      },
      {
        id: 'AwsSolutions-APIG3',
        reason: 'WAF will be added in production environment',
      },
      {
        id: 'AwsSolutions-APIG4',
        reason: 'API key authentication will be implemented in production',
      },
      {
        id: 'AwsSolutions-L1',
        reason: 'Lambda runtime version is current and supported',
      },
      {
        id: 'AwsSolutions-S1',
        reason: 'S3 access logging will be enabled in production',
      },
      {
        id: 'AwsSolutions-EKS1',
        reason: 'EKS endpoint access is configured for development',
      },
    ]);
  }
}
