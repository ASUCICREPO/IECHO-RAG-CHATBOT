#!/bin/bash

# iECHO RAG Chatbot Backend API Deployment Script
set -e

echo "🚀 Starting iECHO RAG Chatbot backend deployment..."

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

print_status() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Check prerequisites
print_status "Checking prerequisites..."

# Check if AWS CLI is installed
if ! command -v aws &> /dev/null; then
    print_error "AWS CLI is not installed. Please install it first."
    exit 1
fi

# Check if CDK is installed
if ! command -v cdk &> /dev/null; then
    print_error "AWS CDK is not installed. Please install it first: npm install -g aws-cdk"
    exit 1
fi

# Check if Node.js is installed
if ! command -v node &> /dev/null; then
    print_error "Node.js is not installed. Please install it first."
    exit 1
fi

# Check if jq is installed (needed for JSON parsing)
if ! command -v jq &> /dev/null; then
    print_error "jq is not installed. Please install it first (brew install jq on macOS, apt-get install jq on Ubuntu)."
    exit 1
fi

# Set default values
export CDK_DEFAULT_ACCOUNT=$(aws sts get-caller-identity --query Account --output text 2>/dev/null || echo "")
export CDK_DEFAULT_REGION=$(aws configure get region 2>/dev/null || echo "us-west-2")

if [ -z "$CDK_DEFAULT_ACCOUNT" ]; then
    print_error "Unable to determine AWS account. Please configure AWS CLI."
    exit 1
fi

print_status "Deploying to account: $CDK_DEFAULT_ACCOUNT in region: $CDK_DEFAULT_REGION"

# Deploy Infrastructure
print_status "Deploying backend infrastructure..."
cd cdk-infrastructure

print_status "Installing CDK dependencies..."
npm install

print_status "Bootstrapping CDK (if needed)..."
cdk bootstrap

print_status "Synthesizing CloudFormation template..."
cdk synth

print_status "Deploying CDK stack..."
cdk deploy --require-approval never

# Capture CDK outputs
print_status "Capturing CDK deployment outputs..."
KNOWLEDGE_BASE_ROLE_ARN=$(aws cloudformation describe-stacks --stack-name IEchoRagChatbotStack --query 'Stacks[0].Outputs[?OutputKey==`KnowledgeBaseRoleArn`].OutputValue' --output text 2>/dev/null || echo "")
VECTOR_BUCKET_ARN=$(aws cloudformation describe-stacks --stack-name IEchoRagChatbotStack --query 'Stacks[0].Outputs[?OutputKey==`VectorBucketArn`].OutputValue' --output text 2>/dev/null || echo "")
DOCUMENT_BUCKET_ARN=$(aws cloudformation describe-stacks --stack-name IEchoRagChatbotStack --query 'Stacks[0].Outputs[?OutputKey==`DocumentBucketArn`].OutputValue' --output text 2>/dev/null || echo "")
HTTP_API_URL=$(aws cloudformation describe-stacks --stack-name IEchoRagChatbotStack --query 'Stacks[0].Outputs[?OutputKey==`HttpApiGatewayUrl`].OutputValue' --output text 2>/dev/null || echo "")

if [ -z "$KNOWLEDGE_BASE_ROLE_ARN" ] || [ -z "$VECTOR_BUCKET_ARN" ] || [ -z "$DOCUMENT_BUCKET_ARN" ]; then
    print_error "Failed to capture CDK outputs. Please check the deployment."
    exit 1
fi

print_status "CDK outputs captured successfully"

# Create Bedrock Knowledge Base with OpenSearch Serverless
print_status "Creating Bedrock Knowledge Base with OpenSearch Serverless..."

# First, we need to create an OpenSearch Serverless collection
print_status "Creating OpenSearch Serverless collection..."

# Create the collection
COLLECTION_RESPONSE=$(aws opensearchserverless create-collection \
    --name "iecho-vector-collection" \
    --description "Vector collection for iECHO multi-modal document processing" \
    --type "VECTORSEARCH" \
    --region "$CDK_DEFAULT_REGION" \
    --output json 2>/dev/null || echo "")

if [ $? -ne 0 ] || [ -z "$COLLECTION_RESPONSE" ]; then
    # Collection might already exist, try to get it
    print_warning "Collection creation failed, checking if it already exists..."
    EXISTING_COLLECTION=$(aws opensearchserverless list-collections \
        --region "$CDK_DEFAULT_REGION" \
        --query 'collectionSummaries[?name==`iecho-vector-collection`]' \
        --output json 2>/dev/null || echo "[]")
    
    if [ "$EXISTING_COLLECTION" != "[]" ] && [ "$EXISTING_COLLECTION" != "" ]; then
        COLLECTION_ARN=$(echo "$EXISTING_COLLECTION" | jq -r '.[0].arn')
        print_status "Using existing collection with ARN: $COLLECTION_ARN"
    else
        print_error "Failed to create or find OpenSearch Serverless collection"
        exit 1
    fi
else
    COLLECTION_ARN=$(echo "$COLLECTION_RESPONSE" | jq -r '.createCollectionDetail.arn')
    print_status "OpenSearch Serverless collection created with ARN: $COLLECTION_ARN"
fi

# Wait for collection to be active
print_status "Waiting for OpenSearch Serverless collection to be active..."
while true; do
    COLLECTION_STATUS=$(aws opensearchserverless get-collection \
        --id "iecho-vector-collection" \
        --region "$CDK_DEFAULT_REGION" \
        --query 'collectionDetail.status' \
        --output text 2>/dev/null || echo "")
    
    if [ "$COLLECTION_STATUS" = "ACTIVE" ]; then
        print_status "OpenSearch Serverless collection is now active"
        break
    elif [ "$COLLECTION_STATUS" = "FAILED" ]; then
        print_error "OpenSearch Serverless collection creation failed"
        exit 1
    else
        print_status "Collection status: $COLLECTION_STATUS - waiting..."
        sleep 15
    fi
done

# Check if knowledge base already exists
EXISTING_KB=$(aws bedrock-agent list-knowledge-bases \
    --region "$CDK_DEFAULT_REGION" \
    --query 'knowledgeBaseSummaries[?name==`iecho-multimodal-kb`].knowledgeBaseId' \
    --output text 2>/dev/null || echo "")

if [ -n "$EXISTING_KB" ] && [ "$EXISTING_KB" != "None" ]; then
    print_warning "Knowledge Base 'iecho-multimodal-kb' already exists with ID: $EXISTING_KB"
    KNOWLEDGE_BASE_ID="$EXISTING_KB"
else
    # Create the knowledge base with OpenSearch Serverless
    KNOWLEDGE_BASE_RESPONSE=$(aws bedrock-agent create-knowledge-base \
    --name "iecho-multimodal-kb" \
    --description "Knowledge base for iECHO multi-modal document processing with S3 vector store" \
    --role-arn "$KNOWLEDGE_BASE_ROLE_ARN" \
    --knowledge-base-configuration '{
        "type": "VECTOR",
        "vectorKnowledgeBaseConfiguration": {
            "embeddingModelArn": "arn:aws:bedrock:'$CDK_DEFAULT_REGION'::foundation-model/amazon.titan-embed-text-v2:0",
            "embeddingModelConfiguration": {
                "bedrockEmbeddingModelConfiguration": {
                    "dimensions": 1024
                }
            }
        }
    }' \
    --storage-configuration '{
        "type": "S3_VECTORS",
        "s3VectorsConfiguration": {
            "vectorBucketArn": "'$VECTOR_BUCKET_ARN'",
            "indexName": "iecho-vector-index"
        }
    }' \
    --region "$CDK_DEFAULT_REGION" \
    --output json)

    if [ $? -ne 0 ]; then
        print_error "Failed to create Knowledge Base with S3 Vectors"
        exit 1
    fi

    KNOWLEDGE_BASE_ID=$(echo "$KNOWLEDGE_BASE_RESPONSE" | jq -r '.knowledgeBase.knowledgeBaseId')
    print_status "Knowledge Base created successfully with ID: $KNOWLEDGE_BASE_ID"
fi

# Wait for knowledge base to be ready
print_status "Waiting for Knowledge Base to be ready..."
while true; do
    KB_STATUS=$(aws bedrock-agent get-knowledge-base \
        --knowledge-base-id "$KNOWLEDGE_BASE_ID" \
        --region "$CDK_DEFAULT_REGION" \
        --query 'knowledgeBase.status' \
        --output text)
    
    if [ "$KB_STATUS" = "ACTIVE" ]; then
        print_status "Knowledge Base is now active"
        break
    elif [ "$KB_STATUS" = "FAILED" ]; then
        print_error "Knowledge Base creation failed"
        exit 1
    else
        print_status "Knowledge Base status: $KB_STATUS - waiting..."
        sleep 10
    fi
done

# Create Data Source
print_status "Creating Data Source for document ingestion..."

# Check if data source already exists
EXISTING_DS=$(aws bedrock-agent list-data-sources \
    --knowledge-base-id "$KNOWLEDGE_BASE_ID" \
    --region "$CDK_DEFAULT_REGION" \
    --query 'dataSourceSummaries[?name==`iecho-document-source`].dataSourceId' \
    --output text 2>/dev/null || echo "")

if [ -n "$EXISTING_DS" ] && [ "$EXISTING_DS" != "None" ]; then
    print_warning "Data Source 'iecho-document-source' already exists with ID: $EXISTING_DS"
    DATA_SOURCE_ID="$EXISTING_DS"
else
    DATA_SOURCE_RESPONSE=$(aws bedrock-agent create-data-source \
    --knowledge-base-id "$KNOWLEDGE_BASE_ID" \
    --name "iecho-document-source" \
    --description "S3 data source with Bedrock Data Automation parsing for multi-modal documents" \
    --data-source-configuration '{
        "type": "S3",
        "s3Configuration": {
            "bucketArn": "'$DOCUMENT_BUCKET_ARN'",
            "inclusionPrefixes": ["processed/"]
        }
    }' \
    --data-deletion-policy "RETAIN" \
    --vector-ingestion-configuration '{
        "chunkingConfiguration": {
            "chunkingStrategy": "HIERARCHICAL",
            "hierarchicalChunkingConfiguration": {
                "levelConfigurations": [
                    {
                        "maxTokens": 1500
                    },
                    {
                        "maxTokens": 300
                    }
                ],
                "overlapTokens": 60
            }
        },
        "parsingConfiguration": {
            "parsingStrategy": "BEDROCK_DATA_AUTOMATION",
            "bedrockDataAutomationConfiguration": {
                "parsingPrompt": {
                    "parsingPromptText": "Extract and structure all content including text, tables, images, and metadata. Preserve document hierarchy and relationships between sections. For multi-modal content: convert tables to structured text, describe visual content, extract text from images, and maintain presentation slide structure."
                }
            }
        }
    }' \
    --region "$CDK_DEFAULT_REGION" \
    --output json)

    if [ $? -ne 0 ]; then
        print_error "Failed to create Data Source"
        exit 1
    fi

    DATA_SOURCE_ID=$(echo "$DATA_SOURCE_RESPONSE" | jq -r '.dataSource.dataSourceId')
    print_status "Data Source created successfully with ID: $DATA_SOURCE_ID"
fi

# Update Lambda environment variables with actual Knowledge Base and Data Source IDs
print_status "Updating Lambda function environment variables..."

# Get the Lambda function name from CloudFormation
LAMBDA_FUNCTION_NAME=$(aws cloudformation describe-stack-resources \
    --stack-name IEchoRagChatbotStack \
    --query 'StackResources[?ResourceType==`AWS::Lambda::Function` && LogicalResourceId==`DocumentProcessor`].PhysicalResourceId' \
    --output text 2>/dev/null || echo "")

if [ -n "$LAMBDA_FUNCTION_NAME" ]; then
    aws lambda update-function-configuration \
        --function-name "$LAMBDA_FUNCTION_NAME" \
        --environment Variables="{KNOWLEDGE_BASE_ID=$KNOWLEDGE_BASE_ID,DATA_SOURCE_ID=$DATA_SOURCE_ID}" \
        --region "$CDK_DEFAULT_REGION" > /dev/null
    print_status "Lambda environment variables updated"
fi

# Update EKS ConfigMap with actual Knowledge Base and Data Source IDs
print_status "Updating EKS ConfigMap..."

# Get EKS cluster name
EKS_CLUSTER_NAME=$(aws cloudformation describe-stacks --stack-name IEchoRagChatbotStack --query 'Stacks[0].Outputs[?OutputKey==`EksClusterName`].OutputValue' --output text 2>/dev/null || echo "")

if [ -n "$EKS_CLUSTER_NAME" ]; then
    # Update kubeconfig
    aws eks update-kubeconfig --region "$CDK_DEFAULT_REGION" --name "$EKS_CLUSTER_NAME" > /dev/null 2>&1
    
    # Update ConfigMap
    kubectl patch configmap iecho-config -n iecho-agents \
        --patch '{"data":{"knowledge-base-id":"'$KNOWLEDGE_BASE_ID'","data-source-id":"'$DATA_SOURCE_ID'"}}' > /dev/null 2>&1 || true
    print_status "EKS ConfigMap updated"
fi

cd ..

# Display results
print_status "Backend deployment completed successfully! 🎉"
echo ""
echo "📋 Deployment Summary:"
echo "======================"
echo "🏗️  Architecture: API Gateway → VPC Link → ALB → EKS Fargate (Strands SDK Agent)"
echo "🧠 Knowledge Base: Bedrock with S3 Vectors storage"
echo "📄 Document Processing: Multi-modal with Bedrock Data Automation"
echo "🔍 Vector Search: S3-based vector storage for cost optimization"
echo ""
echo "🌐 API Endpoints:"
echo "=================="
if [ -n "$HTTP_API_URL" ]; then
    echo "HTTP API Gateway: $HTTP_API_URL"
    echo ""
    echo "Available endpoints:"
    echo "• GET  $HTTP_API_URL/health"
    echo "• POST $HTTP_API_URL/chat"
    echo "• POST $HTTP_API_URL/feedback"
    echo "• GET  $HTTP_API_URL/documents"
else
    echo "❌ API Gateway URL not found. Check deployment logs."
fi

echo ""
echo "🗂️  AWS Resources:"
echo "=================="
echo "Knowledge Base ID: $KNOWLEDGE_BASE_ID"
echo "Data Source ID: $DATA_SOURCE_ID"
echo "Vector Bucket: $(echo $VECTOR_BUCKET_ARN | cut -d':' -f6)"
echo "Document Bucket: $(echo $DOCUMENT_BUCKET_ARN | cut -d':' -f6)"

echo ""
echo "📚 Next Steps:"
echo "=============="
echo "1. Upload documents to the S3 document bucket in the 'uploads/' folder"
echo "2. Documents will be automatically processed and indexed"
echo "3. Test the chat API with your documents"
echo ""
echo "🧪 Test Commands:"
echo "================="
if [ -n "$HTTP_API_URL" ]; then
    echo "# Health check"
    echo "curl -X GET $HTTP_API_URL/health"
    echo ""
    echo "# Chat with your documents"
    echo "curl -X POST $HTTP_API_URL/chat -H 'Content-Type: application/json' -d '{\"query\":\"Hello\",\"userId\":\"test\"}'"
fi
echo ""
echo "⚠️  Note: The EKS Fargate agent may take a few minutes to start up on first deployment."
echo "📚 For detailed instructions, see DEPLOYMENT.md"
