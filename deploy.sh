#!/bin/bash

# iECHO RAG Chatbot Backend API Deployment Script
set -e

echo "🚀 Starting iECHO RAG Chatbot backend deployment..."

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Function to print colored output
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

if ! command -v aws &> /dev/null; then
    print_error "AWS CLI is not installed. Please install it first."
    exit 1
fi

if ! command -v node &> /dev/null; then
    print_error "Node.js is not installed. Please install Node.js 18+ first."
    exit 1
fi

if ! command -v cdk &> /dev/null; then
    print_error "AWS CDK is not installed. Please run: npm install -g aws-cdk"
    exit 1
fi

# Set environment variables
export CDK_DEFAULT_ACCOUNT=$(aws sts get-caller-identity --query Account --output text 2>/dev/null)
export CDK_DEFAULT_REGION=${AWS_DEFAULT_REGION:-us-west-2}

if [ -z "$CDK_DEFAULT_ACCOUNT" ]; then
    print_error "Unable to get AWS account ID. Please check your AWS CLI configuration."
    exit 1
fi

print_status "Deploying to account: $CDK_DEFAULT_ACCOUNT in region: $CDK_DEFAULT_REGION"

# Deploy Infrastructure
print_status "Deploying backend infrastructure..."
cd cdk-infrastructure

print_status "Installing CDK dependencies..."
npm install

print_status "Bootstrapping CDK (if needed)..."
cdk bootstrap aws://$CDK_DEFAULT_ACCOUNT/$CDK_DEFAULT_REGION || true

print_status "Synthesizing CloudFormation template..."
cdk synth

print_status "Deploying CDK stack..."
cdk deploy --require-approval never

# Capture outputs
print_status "Capturing deployment outputs..."
API_URL=$(aws cloudformation describe-stacks --stack-name IEchoRagChatbotStack --query 'Stacks[0].Outputs[?OutputKey==`ApiGatewayUrl`].OutputValue' --output text 2>/dev/null || echo "")
DOCUMENT_BUCKET=$(aws cloudformation describe-stacks --stack-name IEchoRagChatbotStack --query 'Stacks[0].Outputs[?OutputKey==`DocumentBucketName`].OutputValue' --output text 2>/dev/null || echo "")
KNOWLEDGE_BASE_ID=$(aws cloudformation describe-stacks --stack-name IEchoRagChatbotStack --query 'Stacks[0].Outputs[?OutputKey==`KnowledgeBaseId`].OutputValue' --output text 2>/dev/null || echo "")
FEEDBACK_TABLE=$(aws cloudformation describe-stacks --stack-name IEchoRagChatbotStack --query 'Stacks[0].Outputs[?OutputKey==`FeedbackTableName`].OutputValue' --output text 2>/dev/null || echo "")
EKS_CLUSTER=$(aws cloudformation describe-stacks --stack-name IEchoRagChatbotStack --query 'Stacks[0].Outputs[?OutputKey==`EksClusterName`].OutputValue' --output text 2>/dev/null || echo "")
ALB_DNS=$(aws cloudformation describe-stacks --stack-name IEchoRagChatbotStack --query 'Stacks[0].Outputs[?OutputKey==`AgentLoadBalancerDns`].OutputValue' --output text 2>/dev/null || echo "")

cd ..

# Display results
print_status "Backend deployment completed successfully! 🎉"
echo ""
echo "📋 Deployment Summary:"
echo "======================"
echo "🏗️  Architecture: API Gateway → VPC Link → ALB → EKS Fargate (Strands SDK Agent)"
echo ""
if [ -n "$API_URL" ]; then
    echo "🔗 API Gateway URL: $API_URL"
fi
if [ -n "$ALB_DNS" ]; then
    echo "⚖️  Internal ALB DNS: $ALB_DNS"
fi
if [ -n "$EKS_CLUSTER" ]; then
    echo "☸️  EKS Cluster: $EKS_CLUSTER"
fi
if [ -n "$DOCUMENT_BUCKET" ]; then
    echo "📁 Document Bucket: $DOCUMENT_BUCKET"
fi
if [ -n "$KNOWLEDGE_BASE_ID" ]; then
    echo "🧠 Knowledge Base ID: $KNOWLEDGE_BASE_ID"
fi
if [ -n "$FEEDBACK_TABLE" ]; then
    echo "💬 Feedback Table: $FEEDBACK_TABLE"
fi
echo ""
echo "🔌 API Endpoints:"
echo "• GET  $API_URL/health - Health check"
echo "• POST $API_URL/chat - Send chat messages (via Strands SDK Agent)"
echo "• POST $API_URL/feedback - Submit feedback"
echo "• GET  $API_URL/documents - List processed documents"
echo "• POST $API_URL/documents/sync - Trigger knowledge base sync"
echo ""
echo "📝 Next Steps:"
echo "1. Enable Bedrock models in AWS Console:"
echo "   - Amazon Nova Lite"
echo "   - Titan Multimodal Embedding"
echo "2. Upload documents to S3 bucket: $DOCUMENT_BUCKET/uploads/"
echo "3. Wait for EKS Fargate agent to start (may take 2-3 minutes)"
echo "4. Sync the Bedrock Knowledge Base after uploading documents"
echo "5. Test the API endpoints"
echo ""
echo "🧪 Test the API:"
echo "curl -X GET $API_URL/health"
echo "curl -X POST $API_URL/chat -H 'Content-Type: application/json' -d '{\"query\":\"Hello\",\"userId\":\"test\"}'"
echo ""
echo "⚠️  Note: The EKS Fargate agent may take a few minutes to start up on first deployment."
echo "📚 For detailed instructions, see DEPLOYMENT.md"
