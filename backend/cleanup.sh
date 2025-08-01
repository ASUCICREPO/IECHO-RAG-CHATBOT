#!/bin/bash

# iECHO RAG Chatbot Cleanup Script
set -e

echo "🧹 Starting iECHO RAG Chatbot cleanup..."

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
export CDK_DEFAULT_REGION=$(aws configure get region 2>/dev/null || echo "us-west-2")

print_status "Cleaning up resources in region: $CDK_DEFAULT_REGION"

# Get Knowledge Base ID from CloudFormation outputs (if it exists)
print_status "Looking for Knowledge Base to delete..."

# Try to find Knowledge Base by name (since it was created via CLI)
KNOWLEDGE_BASE_ID=$(aws bedrock-agent list-knowledge-bases \
    --region "$CDK_DEFAULT_REGION" \
    --query 'knowledgeBaseSummaries[?name==`iecho-multimodal-kb`].knowledgeBaseId' \
    --output text 2>/dev/null || echo "")

if [ -n "$KNOWLEDGE_BASE_ID" ] && [ "$KNOWLEDGE_BASE_ID" != "None" ]; then
    print_status "Found Knowledge Base: $KNOWLEDGE_BASE_ID"
    
    # Get Data Sources for this Knowledge Base
    print_status "Deleting Data Sources..."
    DATA_SOURCE_IDS=$(aws bedrock-agent list-data-sources \
        --knowledge-base-id "$KNOWLEDGE_BASE_ID" \
        --region "$CDK_DEFAULT_REGION" \
        --query 'dataSourceSummaries[].dataSourceId' \
        --output text 2>/dev/null || echo "")
    
    if [ -n "$DATA_SOURCE_IDS" ]; then
        for DATA_SOURCE_ID in $DATA_SOURCE_IDS; do
            if [ "$DATA_SOURCE_ID" != "None" ]; then
                print_status "Deleting Data Source: $DATA_SOURCE_ID"
                aws bedrock-agent delete-data-source \
                    --knowledge-base-id "$KNOWLEDGE_BASE_ID" \
                    --data-source-id "$DATA_SOURCE_ID" \
                    --region "$CDK_DEFAULT_REGION" > /dev/null 2>&1 || true
            fi
        done
    fi
    
    # Wait a moment for data sources to be deleted
    sleep 5
    
    # Delete the Knowledge Base
    print_status "Deleting Knowledge Base: $KNOWLEDGE_BASE_ID"
    aws bedrock-agent delete-knowledge-base \
        --knowledge-base-id "$KNOWLEDGE_BASE_ID" \
        --region "$CDK_DEFAULT_REGION" > /dev/null 2>&1 || true
    
    print_status "Knowledge Base deletion initiated"
else
    print_warning "No Knowledge Base found to delete"
fi

# Delete CDK Stack
print_status "Deleting CDK stack..."
cd cdk-infrastructure

# Check if stack exists
STACK_EXISTS=$(aws cloudformation describe-stacks --stack-name IEchoRagChatbotStack --region "$CDK_DEFAULT_REGION" --query 'Stacks[0].StackName' --output text 2>/dev/null || echo "")

if [ -n "$STACK_EXISTS" ] && [ "$STACK_EXISTS" != "None" ]; then
    print_status "Found CDK stack, deleting..."
    cdk destroy --force
    print_status "CDK stack deletion completed"
else
    print_warning "No CDK stack found to delete"
fi

cd ..

# Clean up any remaining S3 buckets (if they have content)
print_status "Checking for S3 buckets to clean up..."

# Get account ID
ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text 2>/dev/null || echo "")

if [ -n "$ACCOUNT_ID" ]; then
    # List of bucket patterns to check
    BUCKET_PATTERNS=(
        "iecho-documents-${ACCOUNT_ID}-${CDK_DEFAULT_REGION}"
        "iecho-vector-${ACCOUNT_ID}-${CDK_DEFAULT_REGION}"
    )
    
    for BUCKET_PATTERN in "${BUCKET_PATTERNS[@]}"; do
        # Check if bucket exists
        if aws s3api head-bucket --bucket "$BUCKET_PATTERN" --region "$CDK_DEFAULT_REGION" 2>/dev/null; then
            print_status "Found bucket: $BUCKET_PATTERN"
            
            # Empty the bucket first
            print_status "Emptying bucket: $BUCKET_PATTERN"
            aws s3 rm "s3://$BUCKET_PATTERN" --recursive --region "$CDK_DEFAULT_REGION" 2>/dev/null || true
            
            # Delete versioned objects if any
            aws s3api delete-objects \
                --bucket "$BUCKET_PATTERN" \
                --delete "$(aws s3api list-object-versions \
                    --bucket "$BUCKET_PATTERN" \
                    --query '{Objects: Versions[].{Key:Key,VersionId:VersionId}}' \
                    --region "$CDK_DEFAULT_REGION" 2>/dev/null || echo '{\"Objects\":[]}')" \
                --region "$CDK_DEFAULT_REGION" 2>/dev/null || true
            
            # Delete the bucket
            print_status "Deleting bucket: $BUCKET_PATTERN"
            aws s3api delete-bucket --bucket "$BUCKET_PATTERN" --region "$CDK_DEFAULT_REGION" 2>/dev/null || true
        fi
    done
fi

print_status "Cleanup completed! 🎉"
echo ""
echo "📋 Cleanup Summary:"
echo "==================="
echo "✅ Knowledge Base and Data Sources deleted (if found)"
echo "✅ CDK stack deleted (if found)"
echo "✅ S3 buckets cleaned up (if found)"
echo ""
echo "Note: Some resources may take a few minutes to be fully deleted."
echo "You can check the AWS Console to verify all resources have been removed."
