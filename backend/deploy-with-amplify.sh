#!/bin/bash

# Deploy iECHO RAG Chatbot with Amplify Frontend
# Interactive deployment script

set -e

echo "🚀 iECHO RAG Chatbot Deployment"
echo "=============================="
echo ""

# Prompt for Knowledge Base ID
read -p "Enter your Bedrock Knowledge Base ID: " KNOWLEDGE_BASE_ID
if [ -z "$KNOWLEDGE_BASE_ID" ]; then
    echo "❌ Knowledge Base ID is required"
    exit 1
fi

# Prompt for GitHub Owner
read -p "Enter your GitHub username/organization: " GITHUB_OWNER
if [ -z "$GITHUB_OWNER" ]; then
    echo "❌ GitHub owner is required"
    exit 1
fi

# Prompt for GitHub Repo
read -p "Enter your GitHub repository name [IECHO-RAG-CHATBOT]: " GITHUB_REPO
GITHUB_REPO=${GITHUB_REPO:-"IECHO-RAG-CHATBOT"}

# Prompt for Documents Bucket (optional)
read -p "Enter S3 bucket name for office-to-PDF conversion (optional): " DOCUMENTS_BUCKET

echo ""
echo "📋 Configuration Summary:"
echo "Knowledge Base ID: $KNOWLEDGE_BASE_ID"
echo "GitHub Owner: $GITHUB_OWNER"
echo "GitHub Repo: $GITHUB_REPO"
if [ -n "$DOCUMENTS_BUCKET" ]; then
    echo "Documents Bucket: $DOCUMENTS_BUCKET"
else
    echo "Documents Bucket: Not configured"
fi
echo ""
read -p "Continue with deployment? (y/N): " CONFIRM
if [[ ! $CONFIRM =~ ^[Yy]$ ]]; then
    echo "Deployment cancelled"
    exit 0
fi

# Check if GitHub App access token exists in AWS Secrets Manager
echo "📋 Checking GitHub App access token in AWS Secrets Manager..."
if ! aws secretsmanager describe-secret --secret-id github-access-token >/dev/null 2>&1; then
    echo "❌ GitHub App access token not found in AWS Secrets Manager"
    echo ""
    echo "Please set up GitHub App integration:"
    echo "1. Install Amplify GitHub App: https://github.com/apps/aws-amplify-us-west-2/installations/new"
    echo "2. Create personal access token with 'admin:repo_hook' scope"
    echo "3. Store it: aws secretsmanager create-secret --name github-access-token --secret-string 'your-token'"
    echo ""
    exit 1
else
    echo "✅ GitHub App access token found in AWS Secrets Manager"
fi

# Install dependencies
echo "📦 Installing dependencies..."
npm install

# Build context parameters
CONTEXT_PARAMS="-c knowledgeBaseId=$KNOWLEDGE_BASE_ID -c githubOwner=$GITHUB_OWNER -c githubRepo=$GITHUB_REPO"

if [ -n "$DOCUMENTS_BUCKET" ]; then
    CONTEXT_PARAMS="$CONTEXT_PARAMS -c documentsBucketName=$DOCUMENTS_BUCKET"
    echo "Documents Bucket: $DOCUMENTS_BUCKET"
fi

# Bootstrap CDK if needed
echo "🔧 Bootstrapping CDK..."
cdk bootstrap

# Deploy the stack
echo "🚀 Deploying CDK stack..."
cdk deploy $CONTEXT_PARAMS --require-approval never

# Get Amplify App ID from CDK outputs
echo "📱 Triggering Amplify build..."
AMPLIFY_APP_ID=$(aws cloudformation describe-stacks --stack-name AgentFargateStack --query "Stacks[0].Outputs[?OutputKey=='ExportAmplifyAppId'].OutputValue" --output text)

if [ -n "$AMPLIFY_APP_ID" ]; then
    aws amplify start-job --app-id $AMPLIFY_APP_ID --branch-name full-cdk --job-type RELEASE
    echo "✅ Amplify build started for app: $AMPLIFY_APP_ID"
else
    echo "⚠️  Could not get Amplify App ID - trigger build manually"
fi

echo ""
echo "✅ Deployment completed!"
echo ""
echo "📋 CDK Stack Outputs:"
echo "   - ApiGatewayUrl: Your backend API endpoint"
echo "   - AmplifyAppUrl: Your frontend URL (available after first build)"
echo "   - AmplifyAppId: Your Amplify app ID"
echo "   - AlbDnsName: Your ALB DNS name"
if [ -n "$DOCUMENTS_BUCKET" ]; then
    echo "   - Documents processing enabled for bucket: $DOCUMENTS_BUCKET"
fi
echo ""
echo "📋 Next steps:"
echo "1. Amplify will automatically build and deploy your frontend from the full-cdk branch"
echo "2. The frontend will dynamically use your API Gateway URL"
echo "3. Environment variables are automatically configured:"
echo "   - NEXT_PUBLIC_API_URL: (from CDK output)"
echo ""
echo "🔗 Useful commands:"
echo "   aws amplify list-apps"
echo "   aws amplify get-app --app-id <app-id>"
echo "   aws amplify list-branches --app-id <app-id>"
echo "   aws amplify start-job --app-id <app-id> --branch-name full-cdk --job-type RELEASE"
echo ""
echo "🌐 Access your application:"
echo "   Backend API: Check 'ApiGatewayUrl' in CDK outputs"
echo "   Frontend: Check 'AmplifyAppUrl' in CDK outputs (after first build)"
echo ""