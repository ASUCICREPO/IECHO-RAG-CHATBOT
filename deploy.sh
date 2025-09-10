#!/usr/bin/env bash
set -euo pipefail

# --------------------------------------------------
# iECHO RAG Chatbot Deployment Script
# Usage: ./deploy.sh [destroy]
# --------------------------------------------------

ACTION="${1:-deploy}"

if [ "$ACTION" = "destroy" ]; then
  echo "🗑️  Starting iECHO RAG Chatbot Cleanup..."
else
  echo "🚀 Starting iECHO RAG Chatbot Deployment..."
fi

TIMESTAMP=$(date +%Y%m%d%H%M%S)
PROJECT_NAME="iecho-rag-${TIMESTAMP}"

echo "📋 Project: $PROJECT_NAME"
echo "🎯 Action: $ACTION"

# --------------------------------------------------
# Configuration
# --------------------------------------------------

if [ "$ACTION" != "destroy" ]; then
  # Prompt for required parameters
  read -rp "Enter Bedrock Knowledge Base ID: " KNOWLEDGE_BASE_ID
  read -rp "Enter Documents Bucket Name: " DOCUMENTS_BUCKET

  # Hardcoded GitHub values
  GITHUB_OWNER="ASUCICREPO"
  GITHUB_REPO="IECHO-RAG-CHATBOT"

  # Validate inputs
  if [ -z "$KNOWLEDGE_BASE_ID" ] || [ -z "$DOCUMENTS_BUCKET" ]; then
    echo "❌ Error: Knowledge Base ID and Documents Bucket are required for deployment"
    exit 1
  fi

  echo "✅ Configuration:"
  echo "  - Knowledge Base ID: $KNOWLEDGE_BASE_ID"
  echo "  - GitHub: $GITHUB_OWNER/$GITHUB_REPO"
  echo "  - Documents Bucket: $DOCUMENTS_BUCKET"
else
  # For destroy, try to find existing project
  echo "Available CodeBuild projects:"
  aws codebuild list-projects --query 'projects[?contains(@, `iecho-rag`)]' --output table || echo "No iECHO projects found"
  echo ""
  read -rp "Enter project name to destroy (or press Enter to use latest): " EXISTING_PROJECT
  
  if [ -n "$EXISTING_PROJECT" ]; then
    PROJECT_NAME="$EXISTING_PROJECT"
  fi
fi

# --------------------------------------------------
# Create/Check IAM Role
# --------------------------------------------------

ROLE_NAME="${PROJECT_NAME}-service-role"

if [ "$ACTION" != "destroy" ]; then
  echo "🔐 Setting up IAM role..."
  
  if aws iam get-role --role-name "$ROLE_NAME" >/dev/null 2>&1; then
    echo "✓ IAM role exists: $ROLE_NAME"
    ROLE_ARN=$(aws iam get-role --role-name "$ROLE_NAME" --query 'Role.Arn' --output text)
  else
    echo "Creating IAM role: $ROLE_NAME"
    TRUST_DOC='{
      "Version":"2012-10-17",
      "Statement":[{
        "Effect":"Allow",
        "Principal":{"Service":"codebuild.amazonaws.com"},
        "Action":"sts:AssumeRole"
      }]
    }'

    ROLE_ARN=$(aws iam create-role \
      --role-name "$ROLE_NAME" \
      --assume-role-policy-document "$TRUST_DOC" \
      --query 'Role.Arn' --output text)

    # Create comprehensive policy with specific permissions
    CUSTOM_POLICY='{
      "Version": "2012-10-17",
      "Statement": [
        {
          "Sid": "CodeBuildBasic",
          "Effect": "Allow",
          "Action": [
            "codebuild:CreateReportGroup",
            "codebuild:CreateReport",
            "codebuild:UpdateReport",
            "codebuild:BatchPutTestCases",
            "codebuild:BatchPutCodeCoverages"
          ],
          "Resource": "*"
        },
        {
          "Sid": "CloudWatchLogs",
          "Effect": "Allow",
          "Action": [
            "logs:CreateLogGroup",
            "logs:CreateLogStream",
            "logs:PutLogEvents"
          ],
          "Resource": "*"
        },
        {
          "Sid": "S3Access",
          "Effect": "Allow",
          "Action": [
            "s3:GetObject",
            "s3:GetObjectVersion",
            "s3:PutObject",
            "s3:CreateBucket",
            "s3:DeleteBucket",
            "s3:DeleteObject",
            "s3:ListBucket",
            "s3:GetBucketLocation",
            "s3:GetBucketVersioning"
          ],
          "Resource": "*"
        },
        {
          "Sid": "CloudFormationAccess",
          "Effect": "Allow",
          "Action": [
            "cloudformation:CreateStack",
            "cloudformation:UpdateStack",
            "cloudformation:DeleteStack",
            "cloudformation:DescribeStacks",
            "cloudformation:DescribeStackEvents",
            "cloudformation:DescribeStackResources",
            "cloudformation:GetTemplate",
            "cloudformation:ListStacks",
            "cloudformation:ValidateTemplate",
            "cloudformation:CreateChangeSet",
            "cloudformation:DescribeChangeSet",
            "cloudformation:ExecuteChangeSet",
            "cloudformation:DeleteChangeSet"
          ],
          "Resource": "*"
        },
        {
          "Sid": "IAMAccess",
          "Effect": "Allow",
          "Action": [
            "iam:CreateRole",
            "iam:DeleteRole",
            "iam:GetRole",
            "iam:PassRole",
            "iam:AttachRolePolicy",
            "iam:DetachRolePolicy",
            "iam:PutRolePolicy",
            "iam:DeleteRolePolicy",
            "iam:GetRolePolicy",
            "iam:ListRolePolicies",
            "iam:ListAttachedRolePolicies",
            "iam:CreateServiceLinkedRole",
            "iam:TagRole",
            "iam:UntagRole"
          ],
          "Resource": "*"
        },
        {
          "Sid": "EKSAccess",
          "Effect": "Allow",
          "Action": [
            "eks:CreateCluster",
            "eks:DeleteCluster",
            "eks:DescribeCluster",
            "eks:ListClusters",
            "eks:UpdateClusterConfig",
            "eks:UpdateClusterVersion",
            "eks:TagResource",
            "eks:UntagResource",
            "eks:CreateNodegroup",
            "eks:DeleteNodegroup",
            "eks:DescribeNodegroup",
            "eks:ListNodegroups",
            "eks:UpdateNodegroupConfig",
            "eks:UpdateNodegroupVersion",
            "eks:CreateFargateProfile",
            "eks:DeleteFargateProfile",
            "eks:DescribeFargateProfile",
            "eks:ListFargateProfiles"
          ],
          "Resource": "*"
        },
        {
          "Sid": "EC2Access",
          "Effect": "Allow",
          "Action": [
            "ec2:CreateVpc",
            "ec2:DeleteVpc",
            "ec2:DescribeVpcs",
            "ec2:ModifyVpcAttribute",
            "ec2:CreateSubnet",
            "ec2:DeleteSubnet",
            "ec2:DescribeSubnets",
            "ec2:ModifySubnetAttribute",
            "ec2:CreateInternetGateway",
            "ec2:DeleteInternetGateway",
            "ec2:AttachInternetGateway",
            "ec2:DetachInternetGateway",
            "ec2:DescribeInternetGateways",
            "ec2:CreateNatGateway",
            "ec2:DeleteNatGateway",
            "ec2:DescribeNatGateways",
            "ec2:CreateRouteTable",
            "ec2:DeleteRouteTable",
            "ec2:DescribeRouteTables",
            "ec2:CreateRoute",
            "ec2:DeleteRoute",
            "ec2:AssociateRouteTable",
            "ec2:DisassociateRouteTable",
            "ec2:CreateSecurityGroup",
            "ec2:DeleteSecurityGroup",
            "ec2:DescribeSecurityGroups",
            "ec2:AuthorizeSecurityGroupIngress",
            "ec2:AuthorizeSecurityGroupEgress",
            "ec2:RevokeSecurityGroupIngress",
            "ec2:RevokeSecurityGroupEgress",
            "ec2:CreateTags",
            "ec2:DeleteTags",
            "ec2:DescribeTags",
            "ec2:AllocateAddress",
            "ec2:ReleaseAddress",
            "ec2:DescribeAddresses",
            "ec2:AssociateAddress",
            "ec2:DisassociateAddress",
            "ec2:DescribeAvailabilityZones",
            "ec2:DescribeAccountAttributes",
            "ec2:DescribeNetworkInterfaces",
            "ec2:DeleteNetworkInterface"
          ],
          "Resource": "*"
        },
        {
          "Sid": "ELBAccess",
          "Effect": "Allow",
          "Action": [
            "elasticloadbalancing:CreateLoadBalancer",
            "elasticloadbalancing:DeleteLoadBalancer",
            "elasticloadbalancing:DescribeLoadBalancers",
            "elasticloadbalancing:CreateTargetGroup",
            "elasticloadbalancing:DeleteTargetGroup",
            "elasticloadbalancing:DescribeTargetGroups",
            "elasticloadbalancing:CreateListener",
            "elasticloadbalancing:DeleteListener",
            "elasticloadbalancing:DescribeListeners",
            "elasticloadbalancing:ModifyLoadBalancerAttributes",
            "elasticloadbalancing:ModifyTargetGroupAttributes",
            "elasticloadbalancing:AddTags",
            "elasticloadbalancing:RemoveTags",
            "elasticloadbalancing:DescribeTags"
          ],
          "Resource": "*"
        },
        {
          "Sid": "APIGatewayAccess",
          "Effect": "Allow",
          "Action": [
            "apigateway:GET",
            "apigateway:POST",
            "apigateway:PUT",
            "apigateway:DELETE",
            "apigateway:PATCH"
          ],
          "Resource": "*"
        },
        {
          "Sid": "LambdaAccess",
          "Effect": "Allow",
          "Action": [
            "lambda:CreateFunction",
            "lambda:DeleteFunction",
            "lambda:GetFunction",
            "lambda:UpdateFunctionCode",
            "lambda:UpdateFunctionConfiguration",
            "lambda:ListFunctions",
            "lambda:InvokeFunction",
            "lambda:AddPermission",
            "lambda:RemovePermission",
            "lambda:GetPolicy",
            "lambda:TagResource",
            "lambda:UntagResource"
          ],
          "Resource": "*"
        },
        {
          "Sid": "AmplifyAccess",
          "Effect": "Allow",
          "Action": [
            "amplify:CreateApp",
            "amplify:DeleteApp",
            "amplify:GetApp",
            "amplify:UpdateApp",
            "amplify:ListApps",
            "amplify:CreateBranch",
            "amplify:DeleteBranch",
            "amplify:GetBranch",
            "amplify:UpdateBranch",
            "amplify:ListBranches",
            "amplify:CreateDeployment",
            "amplify:StartDeployment",
            "amplify:GetDeployment",
            "amplify:ListDeployments",
            "amplify:StartJob",
            "amplify:StopJob",
            "amplify:GetJob",
            "amplify:ListJobs",
            "amplify:TagResource",
            "amplify:UntagResource"
          ],
          "Resource": "*"
        },
        {
          "Sid": "BedrockAccess",
          "Effect": "Allow",
          "Action": [
            "bedrock:GetKnowledgeBase",
            "bedrock:ListKnowledgeBases",
            "bedrock:RetrieveAndGenerate",
            "bedrock:Retrieve",
            "bedrock:InvokeModel",
            "bedrock:InvokeModelWithResponseStream"
          ],
          "Resource": "*"
        },
        {
          "Sid": "DynamoDBAccess",
          "Effect": "Allow",
          "Action": [
            "dynamodb:CreateTable",
            "dynamodb:DeleteTable",
            "dynamodb:DescribeTable",
            "dynamodb:ListTables",
            "dynamodb:UpdateTable",
            "dynamodb:PutItem",
            "dynamodb:GetItem",
            "dynamodb:UpdateItem",
            "dynamodb:DeleteItem",
            "dynamodb:Query",
            "dynamodb:Scan",
            "dynamodb:TagResource",
            "dynamodb:UntagResource"
          ],
          "Resource": "*"
        },
        {
          "Sid": "ECRAccess",
          "Effect": "Allow",
          "Action": [
            "ecr:GetAuthorizationToken",
            "ecr:BatchCheckLayerAvailability",
            "ecr:GetDownloadUrlForLayer",
            "ecr:BatchGetImage",
            "ecr:CreateRepository",
            "ecr:DeleteRepository",
            "ecr:DescribeRepositories",
            "ecr:ListImages",
            "ecr:DescribeImages",
            "ecr:PutImage",
            "ecr:InitiateLayerUpload",
            "ecr:UploadLayerPart",
            "ecr:CompleteLayerUpload"
          ],
          "Resource": "*"
        },
        {
          "Sid": "STSAccess",
          "Effect": "Allow",
          "Action": [
            "sts:GetCallerIdentity",
            "sts:AssumeRole"
          ],
          "Resource": "*"
        },
        {
          "Sid": "SSMAccess",
          "Effect": "Allow",
          "Action": [
            "ssm:GetParameter",
            "ssm:GetParameters",
            "ssm:PutParameter",
            "ssm:DeleteParameter",
            "ssm:DescribeParameters"
          ],
          "Resource": "*"
        }
      ]
    }'

    aws iam put-role-policy \
      --role-name "$ROLE_NAME" \
      --policy-name "iECHODeploymentPolicy" \
      --policy-document "$CUSTOM_POLICY"

    echo "✅ IAM role created: $ROLE_ARN"
    echo "⏳ Waiting for IAM role to propagate..."
    sleep 10
  fi
else
  # For destroy, get existing role ARN
  if aws iam get-role --role-name "$ROLE_NAME" >/dev/null 2>&1; then
    ROLE_ARN=$(aws iam get-role --role-name "$ROLE_NAME" --query 'Role.Arn' --output text)
  else
    echo "⚠️  IAM role $ROLE_NAME not found, using default"
    ROLE_ARN="arn:aws:iam::$(aws sts get-caller-identity --query Account --output text):role/service-role/codebuild-service-role"
  fi
fi

# --------------------------------------------------
# Create Source Archive
# --------------------------------------------------

echo "📦 Creating source archive..."
S3_BUCKET="codebuild-source-$(date +%s)"
aws s3 mb s3://$S3_BUCKET

# Create zip of entire project
zip -r source.zip . -x "*.git*" "*/node_modules/*" "*/build/*" "*/.next/*" "*/cdk.out/*" "*.DS_Store*"
aws s3 cp source.zip s3://$S3_BUCKET/
rm source.zip

echo "✅ Source uploaded to: s3://$S3_BUCKET/source.zip"

# --------------------------------------------------
# Create CodeBuild Project
# --------------------------------------------------

CODEBUILD_PROJECT="${PROJECT_NAME}-main"
echo "🔨 Creating CodeBuild project: $CODEBUILD_PROJECT"

# Build environment variables
ENV_VARS='[
  {
    "name": "ACTION",
    "value": "'$ACTION'",
    "type": "PLAINTEXT"
  }'

if [ "$ACTION" != "destroy" ]; then
  ENV_VARS="$ENV_VARS"',
  {
    "name": "KNOWLEDGE_BASE_ID",
    "value": "'$KNOWLEDGE_BASE_ID'",
    "type": "PLAINTEXT"
  },
  {
    "name": "GITHUB_OWNER", 
    "value": "'$GITHUB_OWNER'",
    "type": "PLAINTEXT"
  },
  {
    "name": "GITHUB_REPO",
    "value": "'$GITHUB_REPO'", 
    "type": "PLAINTEXT"
  },
  {
    "name": "DOCUMENTS_BUCKET",
    "value": "'$DOCUMENTS_BUCKET'",
    "type": "PLAINTEXT"
  }'
fi

ENV_VARS="$ENV_VARS"']'

ENVIRONMENT='{
  "type": "LINUX_CONTAINER",
  "image": "aws/codebuild/amazonlinux-x86_64-standard:5.0",
  "computeType": "BUILD_GENERAL1_LARGE",
  "privilegedMode": true,
  "environmentVariables": '$ENV_VARS'
}'

SOURCE='{
  "type": "S3",
  "location": "'$S3_BUCKET'/source.zip",
  "buildspec": "buildspec.yml"
}'

ARTIFACTS='{"type": "NO_ARTIFACTS"}'

# Create CodeBuild project
aws codebuild create-project \
  --name "$CODEBUILD_PROJECT" \
  --source "$SOURCE" \
  --artifacts "$ARTIFACTS" \
  --environment "$ENVIRONMENT" \
  --service-role "$ROLE_ARN" \
  --output json \
  --no-cli-pager >/dev/null

echo "✅ CodeBuild project created"

# --------------------------------------------------
# Start Build
# --------------------------------------------------

echo "▶️  Starting build..."
BUILD_ID=$(aws codebuild start-build \
  --project-name "$CODEBUILD_PROJECT" \
  --query 'build.id' \
  --output text \
  --no-cli-pager)

echo "✅ Build started: $BUILD_ID"
echo "🔗 Monitor at: https://console.aws.amazon.com/codesuite/codebuild/projects/$CODEBUILD_PROJECT/build/$BUILD_ID/"

# --------------------------------------------------
# Wait for Completion
# --------------------------------------------------

echo "⏳ Waiting for build to complete..."
BUILD_STATUS="IN_PROGRESS"

while [ "$BUILD_STATUS" = "IN_PROGRESS" ]; do
  sleep 30
  BUILD_STATUS=$(aws codebuild batch-get-builds --ids "$BUILD_ID" --query 'builds[0].buildStatus' --output text --no-cli-pager)
  echo "Status: $BUILD_STATUS"
done

# --------------------------------------------------
# Cleanup and Results
# --------------------------------------------------

if [ "$ACTION" = "destroy" ]; then
  echo "🧹 Cleaning up IAM role..."
  aws iam delete-role-policy --role-name "$ROLE_NAME" --policy-name "iECHODeploymentPolicy" >/dev/null 2>&1 || true
  aws iam delete-role --role-name "$ROLE_NAME" >/dev/null 2>&1 || true
fi

# --------------------------------------------------
# Final Status
# --------------------------------------------------

if [ "$BUILD_STATUS" = "SUCCEEDED" ]; then
  if [ "$ACTION" = "destroy" ]; then
    echo ""
    echo "🎉 Cleanup completed successfully!"
    echo "✅ All iECHO RAG Chatbot resources have been destroyed"
  else
    echo ""
    echo "🎉 Backend deployment completed successfully!"
    
    # Now deploy frontend
    echo "🎨 Starting frontend deployment..."
    
    # Get backend outputs for frontend
    CDK_OUTPUTS=$(aws cloudformation describe-stacks --stack-name AgentFargateStack --query 'Stacks[0].Outputs' --output json --no-cli-pager)
    
    if [ $? -ne 0 ] || [ -z "$CDK_OUTPUTS" ] || [ "$CDK_OUTPUTS" = "null" ]; then
      echo "❌ Error: Could not retrieve CDK stack outputs"
      echo "Debug: CDK_OUTPUTS = '$CDK_OUTPUTS'"
      exit 1
    fi
    
    API_GATEWAY_URL=$(echo "$CDK_OUTPUTS" | jq -r '.[] | select(.OutputKey == "ExportApiGatewayUrl") | .OutputValue')
    AMPLIFY_APP_ID=$(echo "$CDK_OUTPUTS" | jq -r '.[] | select(.OutputKey == "ExportAmplifyAppId") | .OutputValue')
    
    # Validate required outputs
    if [ -z "$API_GATEWAY_URL" ] || [ "$API_GATEWAY_URL" = "null" ]; then
      echo "❌ Error: Could not find ExportApiGatewayUrl in CDK stack outputs"
      echo "Available outputs:"
      echo "$CDK_OUTPUTS" | jq .
      exit 1
    fi
    
    if [ -z "$AMPLIFY_APP_ID" ] || [ "$AMPLIFY_APP_ID" = "null" ]; then
      echo "❌ Error: Could not find ExportAmplifyAppId in CDK stack outputs"
      echo "Available outputs:"
      echo "$CDK_OUTPUTS" | jq .
      exit 1
    fi
    
    echo "✅ Backend outputs retrieved:"
    echo "  - API Gateway URL: $API_GATEWAY_URL"
    echo "  - Amplify App ID: $AMPLIFY_APP_ID"
    
    # Create frontend CodeBuild project
    FRONTEND_PROJECT="${PROJECT_NAME}-frontend"
    
    echo "📦 Reusing existing source archive for frontend..."
    
    # Build frontend environment variables using helper function
    FRONTEND_ENV_VARS_ARRAY=""
    
    add_frontend_env_var() {
      local name="$1"
      local value="$2"
      if [ -n "$value" ] && [ "$value" != "null" ]; then
        if [ -n "$FRONTEND_ENV_VARS_ARRAY" ]; then
          FRONTEND_ENV_VARS_ARRAY="$FRONTEND_ENV_VARS_ARRAY,"
        fi
        FRONTEND_ENV_VARS_ARRAY="$FRONTEND_ENV_VARS_ARRAY"'{
            "name":  "'"$name"'",
            "value": "'"$value"'",
            "type":  "PLAINTEXT"
          }'
      fi
    }
    
    add_frontend_env_var "API_GATEWAY_URL" "$API_GATEWAY_URL"
    add_frontend_env_var "AMPLIFY_APP_ID" "$AMPLIFY_APP_ID"
    
    FRONTEND_ENVIRONMENT='{
      "type": "LINUX_CONTAINER",
      "image": "aws/codebuild/amazonlinux-x86_64-standard:5.0",
      "computeType": "BUILD_GENERAL1_MEDIUM"'
    
    # Add environment variables if any exist
    if [ -n "$FRONTEND_ENV_VARS_ARRAY" ]; then
      FRONTEND_ENVIRONMENT="$FRONTEND_ENVIRONMENT"',
      "environmentVariables": ['"$FRONTEND_ENV_VARS_ARRAY"']'
    fi
    
    FRONTEND_ENVIRONMENT="$FRONTEND_ENVIRONMENT"'}'
    
    # Debug: Show the environment variables being passed
    echo "🔍 Debug: Environment variables JSON:"
    echo "$FRONTEND_ENVIRONMENT" | jq .
    
    FRONTEND_SOURCE='{
      "type": "S3",
      "location": "'$S3_BUCKET'/source.zip",
      "buildspec": "buildspec-frontend.yml"
    }'
    
    # Create frontend CodeBuild project
    aws codebuild create-project \
      --name "$FRONTEND_PROJECT" \
      --source "$FRONTEND_SOURCE" \
      --artifacts "$ARTIFACTS" \
      --environment "$FRONTEND_ENVIRONMENT" \
      --service-role "$ROLE_ARN" \
      --output json \
      --no-cli-pager >/dev/null
    
    # Start frontend build
    echo "▶️  Starting frontend build..."
    FRONTEND_BUILD_ID=$(aws codebuild start-build \
      --project-name "$FRONTEND_PROJECT" \
      --query 'build.id' \
      --output text \
      --no-cli-pager)
    
    echo "✅ Frontend build started: $FRONTEND_BUILD_ID"
    
    # Wait for frontend completion
    echo "⏳ Waiting for frontend build to complete..."
    FRONTEND_STATUS="IN_PROGRESS"
    
    while [ "$FRONTEND_STATUS" = "IN_PROGRESS" ]; do
      sleep 15
      FRONTEND_STATUS=$(aws codebuild batch-get-builds --ids "$FRONTEND_BUILD_ID" --query 'builds[0].buildStatus' --output text --no-cli-pager)
      echo "Frontend status: $FRONTEND_STATUS"
    done
    
    # Cleanup S3 bucket after both deployments
    echo "🧹 Cleaning up temporary S3 bucket..."
    aws s3 rm s3://$S3_BUCKET --recursive >/dev/null 2>&1 || true
    aws s3 rb s3://$S3_BUCKET >/dev/null 2>&1 || true
    
    if [ "$FRONTEND_STATUS" = "SUCCEEDED" ]; then
      echo ""
      echo "🎉 Full deployment completed successfully!"
      echo "✅ Backend and Frontend deployed successfully!"
      echo ""
      echo "📋 Your iECHO RAG Chatbot is now live!"
      echo "  - API Gateway: $API_GATEWAY_URL"
      echo "  - Frontend: Check Amplify console for URL"
      echo ""
      echo "🔗 CodeBuild Projects (for monitoring/debugging):"
      echo "  - Backend: $CODEBUILD_PROJECT"
      echo "  - Frontend: $FRONTEND_PROJECT"
    else
      echo ""
      echo "❌ Frontend deployment failed with status: $FRONTEND_STATUS"
      echo "✅ Backend deployment was successful"
      echo "🔗 Check frontend logs: https://console.aws.amazon.com/codesuite/codebuild/projects/$FRONTEND_PROJECT/build/$FRONTEND_BUILD_ID/"
      
      # Still cleanup S3 bucket even if frontend failed
      echo "🧹 Cleaning up temporary S3 bucket..."
      aws s3 rm s3://$S3_BUCKET --recursive >/dev/null 2>&1 || true
      aws s3 rb s3://$S3_BUCKET >/dev/null 2>&1 || true
    fi
  fi
else
  echo ""
  echo "❌ Build failed with status: $BUILD_STATUS"
  echo "🔗 Check logs: https://console.aws.amazon.com/codesuite/codebuild/projects/$CODEBUILD_PROJECT/build/$BUILD_ID/"
  exit 1
fi

exit 0
