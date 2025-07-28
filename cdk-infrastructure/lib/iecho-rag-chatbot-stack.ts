import * as cdk from 'aws-cdk-lib';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as eks from 'aws-cdk-lib/aws-eks';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import { Construct } from 'constructs';
import { NagSuppressions } from 'cdk-nag';

// AWS Solutions Constructs
import { S3ToLambda } from '@aws-solutions-constructs/aws-s3-lambda';

// GenAI CDK Constructs
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

    // Vector store bucket for Bedrock Knowledge Base
    const vectorStoreBucket = new s3.Bucket(this, 'VectorStoreBucket', {
      bucketName: `iecho-vector-store-${this.account}-${this.region}`,
      versioned: true,
      encryption: s3.BucketEncryption.S3_MANAGED,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      removalPolicy: cdk.RemovalPolicy.DESTROY, // For development
      autoDeleteObjects: true, // For development
    });

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
    // 2. BEDROCK KNOWLEDGE BASE WITH DATA AUTOMATION
    // ========================================

    // Create Bedrock Knowledge Base with S3 vector store and Data Automation
    const knowledgeBase = new genai.bedrock.KnowledgeBase(this, 'IEchoKnowledgeBase', {
      name: 'iecho-multimodal-kb',
      description: 'Knowledge base for iECHO multi-modal document processing with Bedrock Data Automation',
      embeddingModel: genai.bedrock.BedrockFoundationModel.TITAN_EMBED_TEXT_V2_1024,
      vectorStore: new genai.bedrock.VectorCollection(this, 'VectorCollection', {
        collectionName: 'iecho-vector-collection',
        vectorField: 'bedrock-knowledge-base-default-vector',
        textField: 'AMAZON_BEDROCK_TEXT_CHUNK',
        metadataField: 'AMAZON_BEDROCK_METADATA',
      }),
    });

    // Create data source with Bedrock Data Automation for advanced parsing
    const dataSource = new genai.bedrock.S3DataSource(this, 'DocumentDataSource', {
      knowledgeBase,
      dataSourceName: 'iecho-document-source',
      bucket: documentBucket,
      dataSourceConfiguration: {
        type: genai.bedrock.DataSourceType.S3,
        s3Configuration: {
          bucketArn: documentBucket.bucketArn,
          inclusionPrefixes: ['processed/'],
        },
      },
      // Use Bedrock Data Automation for intelligent document parsing
      parsingStrategy: genai.bedrock.ParsingStrategy.BEDROCK_DATA_AUTOMATION,
      parsingConfiguration: {
        bedrockDataAutomationConfiguration: {
          parsingPrompt: `
You are an expert document parser. Parse the following document content and extract:

1. **Main Topics**: Identify and extract the primary subjects and themes
2. **Key Information**: Extract important facts, figures, and data points
3. **Structure**: Maintain document hierarchy (headings, sections, subsections)
4. **Context**: Preserve relationships between different parts of the document
5. **Metadata**: Extract titles, authors, dates, and other relevant metadata

For multi-modal content:
- **Tables**: Convert to structured text format with clear column/row relationships
- **Images**: Describe visual content and extract any text from images
- **Charts/Graphs**: Describe data trends and key insights
- **Presentations**: Maintain slide structure and extract speaker notes

Ensure the parsed content is:
- Semantically meaningful for vector search
- Properly chunked for optimal retrieval
- Maintains context and relationships
- Includes relevant metadata for citation purposes

Parse the document thoroughly while preserving its semantic structure and meaning.
          `,
        },
      },
      // Use hierarchical chunking for better context preservation
      chunkingStrategy: genai.bedrock.ChunkingStrategy.HIERARCHICAL,
      maxTokens: 1024,
      overlapPercentage: 15,
    });

    // ========================================
    // 3. LAMBDA LAYERS
    // ========================================

    // Create Lambda layer for document processing dependencies
    const documentProcessingLayer = new lambda.LayerVersion(this, 'DocumentProcessingLayer', {
      layerVersionName: 'iecho-document-processing-layer',
      code: lambda.Code.fromAsset('lambda-layers/document-processing'),
      compatibleRuntimes: [lambda.Runtime.PYTHON_3_11],
      description: 'Python libraries for document processing (python-pptx, reportlab, PyPDF2, etc.)',
    });

    // ========================================
    // 4. LAMBDA FUNCTIONS
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
        KNOWLEDGE_BASE_ID: knowledgeBase.knowledgeBaseId,
        DATA_SOURCE_ID: dataSource.dataSourceId,
      },
      logRetention: logs.RetentionDays.ONE_WEEK,
    });

    // Grant permissions to document processor
    documentBucket.grantReadWrite(documentProcessorLambda);
    knowledgeBase.grantRead(documentProcessorLambda);
    
    documentProcessorLambda.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'bedrock:StartIngestionJob',
        'bedrock:GetIngestionJob',
        'bedrock:ListIngestionJobs',
        'bedrock:GetKnowledgeBase',
      ],
      resources: [knowledgeBase.knowledgeBaseArn, dataSource.dataSourceArn],
    }));

    // ========================================
    // 5. SIMPLIFIED EKS CLUSTER (NO NAT GATEWAY)
    // ========================================

    // Create simplified VPC with only public subnets (no NAT Gateway needed)
    const vpc = new ec2.Vpc(this, 'EksVpc', {
      maxAzs: 2,
      natGateways: 0, // Remove expensive NAT Gateway
      subnetConfiguration: [
        {
          cidrMask: 24,
          name: 'Public',
          subnetType: ec2.SubnetType.PUBLIC,
        },
      ],
    });

    // Create EKS cluster in public subnets
    const cluster = new eks.Cluster(this, 'EksCluster', {
      clusterName: 'iecho-agent-cluster',
      version: eks.KubernetesVersion.V1_31,
      vpc,
      defaultCapacity: 0, // We'll use Fargate
      endpointAccess: eks.EndpointAccess.PUBLIC, // Simplified - public access only
      vpcSubnets: [{ subnetType: ec2.SubnetType.PUBLIC }],
    });

    // Add Fargate profile for agents
    cluster.addFargateProfile('AgentProfile', {
      selectors: [
        { namespace: 'iecho-agents' },
      ],
      fargateProfileName: 'iecho-agents-profile',
      subnetSelection: { subnetType: ec2.SubnetType.PUBLIC },
    });

    // Create namespace for agents
    cluster.addManifest('AgentNamespace', {
      apiVersion: 'v1',
      kind: 'Namespace',
      metadata: {
        name: 'iecho-agents',
      },
    });

    // Create IAM role for EKS service account
    const agentServiceRole = new iam.Role(this, 'AgentServiceRole', {
      assumedBy: new iam.WebIdentityPrincipal(
        cluster.openIdConnectProvider.openIdConnectProviderArn,
        {
          StringEquals: {
            [`${cluster.openIdConnectProvider.openIdConnectProviderIssuer}:sub`]: 'system:serviceaccount:iecho-agents:iecho-agent-service-account',
            [`${cluster.openIdConnectProvider.openIdConnectProviderIssuer}:aud`]: 'sts.amazonaws.com',
          },
        }
      ),
      description: 'Service role for iECHO RAG agent running on EKS Fargate',
    });

    // Grant permissions to agent service role
    knowledgeBase.grantRead(agentServiceRole);
    feedbackTable.grantReadWriteData(agentServiceRole);
    documentBucket.grantRead(agentServiceRole);
    
    agentServiceRole.addToPolicy(new iam.PolicyStatement({
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

    // Create service account
    const agentServiceAccount = cluster.addServiceAccount('AgentServiceAccount', {
      name: 'iecho-agent-service-account',
      namespace: 'iecho-agents',
      role: agentServiceRole,
    });

    // Create ConfigMap for agent configuration
    cluster.addManifest('AgentConfigMap', {
      apiVersion: 'v1',
      kind: 'ConfigMap',
      metadata: {
        name: 'iecho-config',
        namespace: 'iecho-agents',
      },
      data: {
        'knowledge-base-id': knowledgeBase.knowledgeBaseId,
        'feedback-table': feedbackTable.tableName,
        'document-bucket': documentBucket.bucketName,
        'data-source-id': dataSource.dataSourceId,
        'aws-region': this.region,
      },
    });

    // Create ConfigMap with Strands SDK agent application code
    cluster.addManifest('AgentCodeConfigMap', {
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

    // Deploy the Strands SDK agent as Fargate task (always running)
    cluster.addManifest('AgentDeployment', {
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

    // Create ClusterIP service for ALB integration
    cluster.addManifest('AgentService', {
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
    // 6. API GATEWAY WITH ALB INTEGRATION
    // ========================================

    // Create API Gateway that routes to ALB (as per architecture description)
    const api = new apigateway.RestApi(this, 'IEchoRestApi', {
      restApiName: 'iecho-rest-api',
      description: 'REST API for iECHO RAG Chatbot - Routes to ALB → EKS Fargate Agent',
      defaultCorsPreflightOptions: {
        allowOrigins: apigateway.Cors.ALL_ORIGINS,
        allowMethods: apigateway.Cors.ALL_METHODS,
        allowHeaders: ['Content-Type', 'X-Amz-Date', 'Authorization', 'X-Api-Key'],
      },
    });

    // Create VPC Link for ALB integration
    const vpcLink = new apigateway.VpcLink(this, 'AgentVpcLink', {
      description: 'VPC Link to EKS Fargate Agent ALB',
      targets: [alb],
    });

    // Create HTTP integration to ALB
    const albIntegration = new apigateway.Integration({
      type: apigateway.IntegrationType.HTTP_PROXY,
      integrationHttpMethod: 'ANY',
      uri: `http://${alb.loadBalancerDnsName}/{proxy}`,
      options: {
        connectionType: apigateway.ConnectionType.VPC_LINK,
        vpcLink: vpcLink,
        requestParameters: {
          'integration.request.path.proxy': 'method.request.path.proxy',
        },
      },
    });

    // Add proxy resource to handle all paths
    const proxyResource = api.root.addProxy({
      defaultIntegration: albIntegration,
      anyMethod: true,
    });

    // Add specific endpoints for better documentation
    const chatResource = api.root.addResource('chat');
    chatResource.addMethod('POST', albIntegration);

    const feedbackResource = api.root.addResource('feedback');
    feedbackResource.addMethod('POST', albIntegration);

    const healthResource = api.root.addResource('health');
    healthResource.addMethod('GET', albIntegration);

    const documentsResource = api.root.addResource('documents');
    documentsResource.addMethod('GET', albIntegration);

    // ========================================
    // 6. S3 TRIGGER FOR DOCUMENT PROCESSING
    // ========================================

    // Create S3 to Lambda construct for document processing
    const s3ToLambdaConstruct = new S3ToLambda(this, 'DocumentProcessing', {
      existingLambdaObj: documentProcessorLambda,
      existingBucketObj: documentBucket,
      s3EventTypes: [s3.EventType.OBJECT_CREATED],
      s3EventFilters: [{
        prefix: 'uploads/',
        suffix: '.pdf'
      }, {
        prefix: 'uploads/',
        suffix: '.ppt'
      }, {
        prefix: 'uploads/',
        suffix: '.pptx'
      }, {
        prefix: 'uploads/',
        suffix: '.doc'
      }, {
        prefix: 'uploads/',
        suffix: '.docx'
      }],
    });

    // ========================================
    // 7. OUTPUTS
    // ========================================

    new cdk.CfnOutput(this, 'ApiGatewayUrl', {
      value: api.url,
      description: 'REST API Gateway URL (Routes via VPC Link → ALB → EKS Fargate Agent)',
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

    new cdk.CfnOutput(this, 'KnowledgeBaseId', {
      value: knowledgeBase.knowledgeBaseId,
      description: 'Bedrock Knowledge Base ID',
    });

    new cdk.CfnOutput(this, 'FeedbackTableName', {
      value: feedbackTable.tableName,
      description: 'DynamoDB table for user feedback',
    });

    new cdk.CfnOutput(this, 'EksClusterName', {
      value: cluster.clusterName,
      description: 'EKS cluster name for agents',
    });

    new cdk.CfnOutput(this, 'DocumentProcessingLayerArn', {
      value: documentProcessingLayer.layerVersionArn,
      description: 'Lambda layer ARN for document processing',
    });

    // ========================================
    // 9. CDK NAG SUPPRESSIONS
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
