#!/bin/bash

# iECHO RAG Chatbot Configuration Update Script
# Use this after manually creating the Knowledge Base and Data Source
set -e

echo "🔧 Updating iECHO RAG Chatbot configurations..."

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

# Set default values
export CDK_DEFAULT_ACCOUNT=$(aws sts get-caller-identity --query Account --output text 2>/dev/null || echo "")
export CDK_DEFAULT_REGION=$(aws configure get region 2>/dev/null || echo "us-west-2")

if [ -z "$CDK_DEFAULT_ACCOUNT" ]; then
    print_error "Unable to determine AWS account. Please configure AWS CLI."
    exit 1
fi

print_status "Updating configurations for account: $CDK_DEFAULT_ACCOUNT in region: $CDK_DEFAULT_REGION"

# Prompt for Knowledge Base ID and Data Source ID
echo ""
echo "📋 Please provide the following information from your manually created Knowledge Base:"
echo ""

read -p "🧠 Knowledge Base ID (from Bedrock Console): " KNOWLEDGE_BASE_ID
read -p "📄 Data Source ID (from Bedrock Console): " DATA_SOURCE_ID

if [ -z "$KNOWLEDGE_BASE_ID" ] || [ -z "$DATA_SOURCE_ID" ]; then
    print_error "Both Knowledge Base ID and Data Source ID are required."
    exit 1
fi

print_status "Using Knowledge Base ID: $KNOWLEDGE_BASE_ID"
print_status "Using Data Source ID: $DATA_SOURCE_ID"

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
else
    print_warning "Lambda function not found. Skipping Lambda update."
fi

# Update EKS ConfigMap with actual Knowledge Base and Data Source IDs
print_status "Updating EKS ConfigMap..."

# Get EKS cluster name
EKS_CLUSTER_NAME=$(aws cloudformation describe-stacks --stack-name IEchoRagChatbotStack --query 'Stacks[0].Outputs[?OutputKey==`EksClusterName`].OutputValue' --output text 2>/dev/null || echo "")

if [ -n "$EKS_CLUSTER_NAME" ]; then
    # Update kubeconfig
    print_status "Updating kubeconfig for cluster: $EKS_CLUSTER_NAME"
    aws eks update-kubeconfig --region "$CDK_DEFAULT_REGION" --name "$EKS_CLUSTER_NAME" > /dev/null 2>&1
    
    # Update ConfigMap
    print_status "Patching ConfigMap with real Knowledge Base and Data Source IDs..."
    kubectl patch configmap iecho-config -n iecho-agents \
        --patch '{"data":{"knowledge-base-id":"'$KNOWLEDGE_BASE_ID'","data-source-id":"'$DATA_SOURCE_ID'"}}' > /dev/null 2>&1 || true
    
    if [ $? -eq 0 ]; then
        print_status "EKS ConfigMap updated successfully"
        
        # Restart the deployment to pick up new config
        print_status "Restarting agent deployment to pick up new configuration..."
        kubectl rollout restart deployment/iecho-rag-agent -n iecho-agents > /dev/null 2>&1 || true
        
        if [ $? -eq 0 ]; then
            print_status "Agent deployment restarted"
        else
            print_warning "Failed to restart deployment. You may need to restart manually."
        fi
    else
        print_warning "Failed to update EKS ConfigMap. You may need to update manually."
    fi
else
    print_warning "EKS cluster not found. Skipping EKS update."
fi

# Display results
print_status "Configuration update completed! 🎉"
echo ""
echo "📋 Updated Configuration:"
echo "========================="
echo "Knowledge Base ID: $KNOWLEDGE_BASE_ID"
echo "Data Source ID: $DATA_SOURCE_ID"
echo ""

# Get API Gateway URL
HTTP_API_URL=$(aws cloudformation describe-stacks --stack-name IEchoRagChatbotStack --query 'Stacks[0].Outputs[?OutputKey==`HttpApiGatewayUrl`].OutputValue' --output text 2>/dev/null || echo "")

if [ -n "$HTTP_API_URL" ]; then
    echo "🌐 API Endpoints:"
    echo "=================="
    echo "HTTP API Gateway: $HTTP_API_URL"
    echo ""
    echo "Available endpoints:"
    echo "• GET  $HTTP_API_URL/health"
    echo "• POST $HTTP_API_URL/chat"
    echo "• POST $HTTP_API_URL/feedback"
    echo "• GET  $HTTP_API_URL/documents"
    echo ""
    
    echo "🧪 Test Commands:"
    echo "================="
    echo "# Health check"
    echo "curl -X GET $HTTP_API_URL/health"
    echo ""
    echo "# Chat with your documents"
    echo "curl -X POST $HTTP_API_URL/chat -H 'Content-Type: application/json' -d '{\"query\":\"Hello\",\"userId\":\"test\"}'"
fi

echo ""
echo "📚 Next Steps:"
echo "=============="
echo "1. Upload documents to the S3 document bucket in the 'uploads/' folder"
echo "2. Documents will be automatically processed and indexed"
echo "3. Test the chat API with your documents"
echo "4. Check EKS pods: kubectl get pods -n iecho-agents"
echo ""
echo "⚠️  Note: The EKS Fargate agent may take a few minutes to start up after configuration update."
