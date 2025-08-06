#!/bin/bash

# iECHO RAG Chatbot - Unified Deployment Script
# Deploys the complete system with all optional components
set -e

echo "🚀 Starting iECHO RAG Chatbot unified deployment..."

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
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

print_action() {
    echo -e "${BLUE}[ACTION]${NC} $1"
}

# Show usage
show_usage() {
    echo "Usage: $0 KNOWLEDGE_BASE_ID [OPTIONS]"
    echo ""
    echo "Options:"
    echo "  --with-api-gateway    Deploy with API Gateway (recommended for production)"
    echo "  --with-lambda         Deploy Lambda function for PPT to PDF conversion"
    echo "  --full-production     Deploy with API Gateway + Lambda (complete setup)"
    echo "  --alb-only           Deploy with ALB only (default, development mode)"
    echo "  --help               Show this help message"
    echo ""
    echo "Examples:"
    echo "  $0 VEBRQICW1Y                        # Basic deployment (ALB only)"
    echo "  $0 VEBRQICW1Y --with-api-gateway     # Production API"
    echo "  $0 VEBRQICW1Y --with-lambda          # With document processing"
    echo "  $0 VEBRQICW1Y --full-production      # Complete production setup"
    echo ""
    echo "📝 Prerequisites:"
    echo "1. Create Knowledge Base manually via AWS Console"
    echo "2. Use S3 Vector Store type"
    echo "3. Note the Knowledge Base ID"
    echo ""
    echo "🔧 Components:"
    echo "- EKS Auto Mode cluster with Fargate"
    echo "- S3 bucket for documents"
    echo "- DynamoDB table for feedback"
    echo "- Nova Lite integration"
    echo "- API Gateway (optional)"
    echo "- Lambda PPT processor (optional)"
}

# Parse arguments
KNOWLEDGE_BASE_ID=""
DEPLOY_API_GATEWAY=false
DEPLOY_LAMBDA=false

while [[ $# -gt 0 ]]; do
    case $1 in
        --with-api-gateway)
            DEPLOY_API_GATEWAY=true
            shift
            ;;
        --with-lambda)
            DEPLOY_LAMBDA=true
            shift
            ;;
        --full-production)
            DEPLOY_API_GATEWAY=true
            DEPLOY_LAMBDA=true
            shift
            ;;
        --alb-only)
            DEPLOY_API_GATEWAY=false
            DEPLOY_LAMBDA=false
            shift
            ;;
        --help)
            show_usage
            exit 0
            ;;
        -*)
            print_error "Unknown option $1"
            show_usage
            exit 1
            ;;
        *)
            if [ -z "$KNOWLEDGE_BASE_ID" ]; then
                KNOWLEDGE_BASE_ID=$1
            else
                print_error "Multiple Knowledge Base IDs provided"
                show_usage
                exit 1
            fi
            shift
            ;;
    esac
done

# Check if Knowledge Base ID is provided
if [ -z "$KNOWLEDGE_BASE_ID" ]; then
    print_error "Knowledge Base ID is required!"
    echo ""
    show_usage
    exit 1
fi

print_status "Using Knowledge Base ID: $KNOWLEDGE_BASE_ID"

# Show deployment mode
DEPLOYMENT_MODE="EKS + ALB"
if [ "$DEPLOY_API_GATEWAY" = true ]; then
    DEPLOYMENT_MODE="$DEPLOYMENT_MODE + API Gateway"
fi
if [ "$DEPLOY_LAMBDA" = true ]; then
    DEPLOYMENT_MODE="$DEPLOYMENT_MODE + Lambda (PPT Processing)"
fi

if [ "$DEPLOY_API_GATEWAY" = true ] || [ "$DEPLOY_LAMBDA" = true ]; then
    print_status "🏢 Deployment mode: $DEPLOYMENT_MODE (Production)"
else
    print_status "🔧 Deployment mode: $DEPLOYMENT_MODE (Development)"
fi

# Check prerequisites
print_action "Checking prerequisites..."

command -v aws >/dev/null 2>&1 || { print_error "AWS CLI is required but not installed. Aborting."; exit 1; }
command -v eksctl >/dev/null 2>&1 || { print_error "eksctl is required but not installed. Aborting."; exit 1; }
command -v kubectl >/dev/null 2>&1 || { print_error "kubectl is required but not installed. Aborting."; exit 1; }
command -v helm >/dev/null 2>&1 || { print_error "Helm is required but not installed. Aborting."; exit 1; }
command -v docker >/dev/null 2>&1 || { print_error "Docker is required but not installed. Aborting."; exit 1; }
command -v jq >/dev/null 2>&1 || { print_error "jq is required but not installed. Aborting."; exit 1; }

print_status "All prerequisites met!"

# Set environment variables
export AWS_ACCOUNT_ID=$(aws sts get-caller-identity --query 'Account' --output text)
export AWS_REGION=${AWS_REGION:-us-west-2}
export CLUSTER_NAME=${CLUSTER_NAME:-iecho-rag-cluster}
export ECR_REPOSITORY=${ECR_REPOSITORY:-iecho-rag-chatbot}

print_status "Using AWS Account: $AWS_ACCOUNT_ID"
print_status "Using AWS Region: $AWS_REGION"
print_status "Using Cluster Name: $CLUSTER_NAME"
# Step 1: Create EKS Auto Mode cluster
print_action "Step 1: Creating EKS Auto Mode cluster..."

if aws eks describe-cluster --name $CLUSTER_NAME --region $AWS_REGION >/dev/null 2>&1; then
    print_warning "EKS cluster $CLUSTER_NAME already exists, skipping creation"
else
    print_status "Creating EKS Auto Mode cluster: $CLUSTER_NAME"
    eksctl create cluster --name $CLUSTER_NAME --enable-auto-mode --region $AWS_REGION
    print_status "EKS cluster created successfully!"
fi

# Configure kubeconfig
print_status "Configuring kubeconfig..."
aws eks update-kubeconfig --name $CLUSTER_NAME --region $AWS_REGION

# Step 2: Create S3 bucket for documents
print_action "Step 2: Creating S3 bucket for documents..."

DOCUMENTS_BUCKET="iecho-documents-${AWS_ACCOUNT_ID}-${AWS_REGION}"

if aws s3api head-bucket --bucket $DOCUMENTS_BUCKET --region $AWS_REGION >/dev/null 2>&1; then
    print_warning "S3 bucket $DOCUMENTS_BUCKET already exists, skipping creation"
else
    print_status "Creating S3 bucket: $DOCUMENTS_BUCKET"
    if [ "$AWS_REGION" = "us-east-1" ]; then
        aws s3api create-bucket --bucket $DOCUMENTS_BUCKET --region $AWS_REGION
    else
        aws s3api create-bucket --bucket $DOCUMENTS_BUCKET --region $AWS_REGION \
            --create-bucket-configuration LocationConstraint=$AWS_REGION
    fi
    
    # Enable versioning
    aws s3api put-bucket-versioning --bucket $DOCUMENTS_BUCKET \
        --versioning-configuration Status=Enabled --region $AWS_REGION
    
    # Create folder structure
    aws s3api put-object --bucket $DOCUMENTS_BUCKET --key uploads/ --region $AWS_REGION
    aws s3api put-object --bucket $DOCUMENTS_BUCKET --key processed/ --region $AWS_REGION
    
    print_status "S3 bucket created and configured!"
fi

# Step 3: Create DynamoDB table for feedback
print_action "Step 3: Creating DynamoDB table for feedback..."

FEEDBACK_TABLE_NAME="iecho-feedback-table"

if aws dynamodb describe-table --table-name $FEEDBACK_TABLE_NAME --region $AWS_REGION >/dev/null 2>&1; then
    print_warning "DynamoDB table $FEEDBACK_TABLE_NAME already exists, skipping creation"
else
    print_status "Creating DynamoDB table: $FEEDBACK_TABLE_NAME"
    aws dynamodb create-table \
        --table-name $FEEDBACK_TABLE_NAME \
        --attribute-definitions \
            AttributeName=feedbackId,AttributeType=S \
        --key-schema \
            AttributeName=feedbackId,KeyType=HASH \
        --billing-mode PAY_PER_REQUEST \
        --region $AWS_REGION
    
    print_status "DynamoDB table created!"
fi

# Step 4: Build and push Docker image
print_action "Step 4: Building and pushing Docker image..."

# Authenticate to ECR
print_status "Authenticating to Amazon ECR..."
aws ecr get-login-password --region $AWS_REGION | docker login --username AWS --password-stdin $AWS_ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com

# Create ECR repository if it doesn't exist
if aws ecr describe-repositories --repository-names $ECR_REPOSITORY --region $AWS_REGION >/dev/null 2>&1; then
    print_warning "ECR repository $ECR_REPOSITORY already exists"
else
    print_status "Creating ECR repository: $ECR_REPOSITORY"
    aws ecr create-repository --repository-name $ECR_REPOSITORY --region $AWS_REGION
fi

# Build Docker image
print_status "Building Docker image..."
docker build --platform linux/amd64 -t $ECR_REPOSITORY:latest docker/

# Tag and push image
print_status "Tagging and pushing Docker image..."
docker tag $ECR_REPOSITORY:latest $AWS_ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com/$ECR_REPOSITORY:latest
docker push $AWS_ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com/$ECR_REPOSITORY:latest

print_status "Docker image pushed successfully!"

# Step 5: Configure EKS Pod Identity for Bedrock access
print_action "Step 5: Configuring EKS Pod Identity..."

# Create comprehensive IAM policy for Bedrock access
BEDROCK_POLICY_NAME="iecho-bedrock-nova-lite-policy"

cat > bedrock-policy.json << EOF
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "bedrock:*",
        "bedrock-agent:*",
        "bedrock-agent-runtime:*"
      ],
      "Resource": "*"
    },
    {
      "Effect": "Allow",
      "Action": [
        "s3:GetObject",
        "s3:PutObject",
        "s3:DeleteObject",
        "s3:ListBucket"
      ],
      "Resource": [
        "arn:aws:s3:::${DOCUMENTS_BUCKET}",
        "arn:aws:s3:::${DOCUMENTS_BUCKET}/*"
      ]
    },
    {
      "Effect": "Allow",
      "Action": [
        "dynamodb:PutItem",
        "dynamodb:GetItem",
        "dynamodb:Query",
        "dynamodb:Scan"
      ],
      "Resource": "arn:aws:dynamodb:${AWS_REGION}:${AWS_ACCOUNT_ID}:table/${FEEDBACK_TABLE_NAME}"
    }
  ]
}
EOF

# Create or update the policy
aws iam create-policy \
    --policy-name $BEDROCK_POLICY_NAME \
    --policy-document file://bedrock-policy.json >/dev/null 2>&1 || \
aws iam create-policy-version \
    --policy-arn arn:aws:iam::$AWS_ACCOUNT_ID:policy/$BEDROCK_POLICY_NAME \
    --policy-document file://bedrock-policy.json \
    --set-as-default >/dev/null 2>&1 || true

# Create Pod Identity association
print_status "Creating Pod Identity association..."
eksctl create podidentityassociation --cluster $CLUSTER_NAME \
    --namespace default \
    --service-account-name iecho-rag-chatbot \
    --permission-policy-arns arn:aws:iam::$AWS_ACCOUNT_ID:policy/$BEDROCK_POLICY_NAME \
    --role-name eks-iecho-rag-chatbot-nova --region $AWS_REGION || true

# Also attach AWS managed Bedrock policy for comprehensive access
ROLE_NAME="eks-iecho-rag-chatbot-nova"
aws iam attach-role-policy --role-name $ROLE_NAME \
    --policy-arn arn:aws:iam::aws:policy/AmazonBedrockFullAccess >/dev/null 2>&1 || true

# Clean up temporary file
rm -f bedrock-policy.json
# Step 6: Deploy application with Helm
print_action "Step 6: Deploying application with Helm..."

# Clean up any existing deployment first
print_status "Cleaning up any existing deployment..."
helm uninstall iecho-rag-chatbot --no-hooks >/dev/null 2>&1 || true
kubectl delete all,ingress,configmap,secret,serviceaccount,pdb \
    -l app.kubernetes.io/name=iecho-rag-chatbot >/dev/null 2>&1 || true

# Wait for cleanup
sleep 10

# Create IngressClass for ALB
print_status "Creating IngressClass for Application Load Balancer..."
cat <<EOF | kubectl apply -f -
apiVersion: eks.amazonaws.com/v1
kind: IngressClassParams
metadata:
  name: alb
spec:
  scheme: internet-facing
EOF

cat <<EOF | kubectl apply -f -
apiVersion: networking.k8s.io/v1
kind: IngressClass
metadata:
  name: alb
  annotations:
    ingressclass.kubernetes.io/is-default-class: "true"
spec:
  controller: eks.amazonaws.com/alb
  parameters:
    apiGroup: eks.amazonaws.com
    kind: IngressClassParams
    name: alb
EOF

# Deploy with Helm using proper string formatting
print_status "Deploying iECHO RAG Chatbot with Helm..."
helm install iecho-rag-chatbot ./chart \
    --set image.repository="$AWS_ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com/$ECR_REPOSITORY" \
    --set image.tag="latest" \
    --set ingress.enabled=true \
    --set ingress.className="alb" \
    --set env[0].name="KNOWLEDGE_BASE_ID" \
    --set env[0].value="$KNOWLEDGE_BASE_ID" \
    --set env[1].name="DOCUMENTS_BUCKET" \
    --set env[1].value="$DOCUMENTS_BUCKET" \
    --set env[2].name="FEEDBACK_TABLE_NAME" \
    --set env[2].value="$FEEDBACK_TABLE_NAME" \
    --set env[3].name="AWS_REGION" \
    --set env[3].value="$AWS_REGION" \
    --set env[4].name="AWS_ACCOUNT_ID" \
    --set-string env[4].value="$AWS_ACCOUNT_ID"

# Wait for deployment to be ready
print_status "Waiting for deployment to be ready..."
kubectl wait --for=condition=available deployments iecho-rag-chatbot --timeout=300s

# Step 7: Get ALB URL
print_action "Step 7: Getting Application Load Balancer URL..."

# Wait for ingress to get ALB URL
print_status "Waiting for ALB to be provisioned..."
sleep 60

ALB_URL=$(kubectl get ingress iecho-rag-chatbot -o jsonpath='{.status.loadBalancer.ingress[0].hostname}' 2>/dev/null || echo "")

if [ -n "$ALB_URL" ]; then
    print_status "ALB URL: http://$ALB_URL"
    
    # Wait for ALB to be active
    print_status "Waiting for ALB to be active..."
    aws elbv2 wait load-balancer-available --load-balancer-arns $(aws elbv2 describe-load-balancers --query 'LoadBalancers[?DNSName==`'"$ALB_URL"'`].LoadBalancerArn' --output text) --region $AWS_REGION || true
    
    # Additional wait for DNS propagation
    print_status "Waiting for DNS propagation..."
    sleep 60
else
    print_warning "Could not get ALB URL. Check ingress status with: kubectl get ingress"
fi
# Step 8: Set up API Gateway (if requested)
API_GATEWAY_URL=""
if [ "$DEPLOY_API_GATEWAY" = true ]; then
    print_action "Step 8: Setting up API Gateway..."
    
    if [ -z "$ALB_URL" ]; then
        print_error "Cannot set up API Gateway without ALB URL"
        exit 1
    fi
    
    API_NAME="iecho-rag-chatbot-api"
    
    # Create API Gateway
    print_status "Creating API Gateway..."
    API_RESPONSE=$(aws apigateway create-rest-api \
        --name $API_NAME \
        --description "iECHO RAG Chatbot API with Nova Lite" \
        --endpoint-configuration types=REGIONAL \
        --region $AWS_REGION 2>/dev/null || echo '{"id":"exists"}')
    
    API_ID=$(echo $API_RESPONSE | jq -r '.id')
    
    if [ "$API_ID" = "exists" ]; then
        # Get existing API ID
        API_ID=$(aws apigateway get-rest-apis --region $AWS_REGION --query "items[?name=='$API_NAME'].id" --output text)
        print_warning "API Gateway already exists with ID: $API_ID"
    else
        print_status "API Gateway created with ID: $API_ID"
    fi
    
    # Get root resource ID
    ROOT_RESOURCE_ID=$(aws apigateway get-resources --rest-api-id $API_ID --region $AWS_REGION --query 'items[?path==`/`].id' --output text)
    
    # Function to create resource and method
    create_endpoint() {
        local path_part=$1
        local target_path=$2
        local http_method=$3
        
        # Create resource
        RESOURCE_RESPONSE=$(aws apigateway create-resource \
            --rest-api-id $API_ID \
            --parent-id $ROOT_RESOURCE_ID \
            --path-part $path_part \
            --region $AWS_REGION 2>/dev/null || echo '{"id":"exists"}')
        
        RESOURCE_ID=$(echo $RESOURCE_RESPONSE | jq -r '.id')
        
        if [ "$RESOURCE_ID" = "exists" ]; then
            RESOURCE_ID=$(aws apigateway get-resources --rest-api-id $API_ID --region $AWS_REGION --query "items[?pathPart=='$path_part'].id" --output text)
        fi
        
        # Create method
        aws apigateway put-method \
            --rest-api-id $API_ID \
            --resource-id $RESOURCE_ID \
            --http-method $http_method \
            --authorization-type NONE \
            --region $AWS_REGION >/dev/null 2>&1 || true
        
        # Create integration
        aws apigateway put-integration \
            --rest-api-id $API_ID \
            --resource-id $RESOURCE_ID \
            --http-method $http_method \
            --type HTTP_PROXY \
            --integration-http-method $http_method \
            --uri "http://$ALB_URL$target_path" \
            --region $AWS_REGION >/dev/null 2>&1 || true
    }
    
    # Create all endpoints
    print_status "Creating API endpoints..."
    create_endpoint "health" "/health" "GET"
    create_endpoint "status" "/status" "GET"
    create_endpoint "chat" "/chat" "POST"
    create_endpoint "feedback" "/feedback" "POST"
    create_endpoint "documents" "/documents" "GET"
    
    # Deploy API
    print_status "Deploying API..."
    aws apigateway create-deployment \
        --rest-api-id $API_ID \
        --stage-name prod \
        --stage-description "Production stage" \
        --region $AWS_REGION >/dev/null 2>&1 || true
    
    # Set API Gateway URL
    API_GATEWAY_URL="https://$API_ID.execute-api.$AWS_REGION.amazonaws.com/prod"
    
    print_status "API Gateway setup completed!"
    print_status "API Gateway URL: $API_GATEWAY_URL"
fi
# Step 9: Deploy Lambda function (if requested)
if [ "$DEPLOY_LAMBDA" = true ]; then
    print_action "Step 9: Deploying Lambda function for document processing..."
    
    if [ -n "$DOCUMENTS_BUCKET" ]; then
        # Build Lambda deployment package
        print_status "Building Lambda deployment package..."
        if [ -d "lambda" ]; then
            cd lambda
            ./build-lambda.sh
            cd ..
        else
            print_error "Lambda directory not found. Skipping Lambda deployment."
            DEPLOY_LAMBDA=false
        fi
        
        if [ "$DEPLOY_LAMBDA" = true ] && [ -f "lambda/document-processor.zip" ]; then
            # Get Data Source ID from Knowledge Base (if available)
            DATA_SOURCE_ID=""
            DATA_SOURCE_ID=$(aws bedrock-agent list-data-sources --knowledge-base-id $KNOWLEDGE_BASE_ID --region $AWS_REGION --query 'dataSourceSummaries[0].dataSourceId' --output text 2>/dev/null || echo "")
            if [ "$DATA_SOURCE_ID" = "None" ] || [ -z "$DATA_SOURCE_ID" ]; then
                print_warning "Could not find Data Source ID. Lambda will skip auto-sync."
                DATA_SOURCE_ID=""
            else
                print_status "Found Data Source ID: $DATA_SOURCE_ID"
            fi
            
            # Create Lambda IAM role and policies
            LAMBDA_ROLE_NAME="iecho-document-processor-role"
            LAMBDA_POLICY_NAME="iecho-document-processor-policy"
            
            # Create trust policy for Lambda
            cat > lambda-trust-policy.json << EOF
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "Service": "lambda.amazonaws.com"
      },
      "Action": "sts:AssumeRole"
    }
  ]
}
EOF

            # Create Lambda execution policy
            cat > lambda-execution-policy.json << EOF
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "logs:CreateLogGroup",
        "logs:CreateLogStream",
        "logs:PutLogEvents"
      ],
      "Resource": "arn:aws:logs:${AWS_REGION}:${AWS_ACCOUNT_ID}:*"
    },
    {
      "Effect": "Allow",
      "Action": [
        "s3:GetObject",
        "s3:PutObject",
        "s3:DeleteObject",
        "s3:ListBucket"
      ],
      "Resource": [
        "arn:aws:s3:::${DOCUMENTS_BUCKET}",
        "arn:aws:s3:::${DOCUMENTS_BUCKET}/*"
      ]
    },
    {
      "Effect": "Allow",
      "Action": [
        "bedrock-agent:StartIngestionJob",
        "bedrock-agent:GetIngestionJob",
        "bedrock-agent:ListIngestionJobs"
      ],
      "Resource": "*"
    }
  ]
}
EOF

            # Create Lambda role
            if aws iam get-role --role-name $LAMBDA_ROLE_NAME --region $AWS_REGION >/dev/null 2>&1; then
                print_warning "Lambda role already exists: $LAMBDA_ROLE_NAME"
            else
                print_status "Creating Lambda role: $LAMBDA_ROLE_NAME"
                aws iam create-role \
                    --role-name $LAMBDA_ROLE_NAME \
                    --assume-role-policy-document file://lambda-trust-policy.json \
                    --region $AWS_REGION >/dev/null
            fi
            
            # Create and attach Lambda policy
            aws iam create-policy \
                --policy-name $LAMBDA_POLICY_NAME \
                --policy-document file://lambda-execution-policy.json >/dev/null 2>&1 || \
            aws iam create-policy-version \
                --policy-arn arn:aws:iam::$AWS_ACCOUNT_ID:policy/$LAMBDA_POLICY_NAME \
                --policy-document file://lambda-execution-policy.json \
                --set-as-default >/dev/null 2>&1 || true
            
            # Attach policies to Lambda role
            aws iam attach-role-policy \
                --role-name $LAMBDA_ROLE_NAME \
                --policy-arn arn:aws:iam::$AWS_ACCOUNT_ID:policy/$LAMBDA_POLICY_NAME >/dev/null 2>&1 || true
            
            aws iam attach-role-policy \
                --role-name $LAMBDA_ROLE_NAME \
                --policy-arn arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole >/dev/null 2>&1 || true
            
            print_status "IAM role and policies configured"
            
            # Wait for role to be available
            print_status "Waiting for IAM role to be available..."
            sleep 15
            
            # Create or update Lambda function
            LAMBDA_FUNCTION_NAME="iecho-document-processor"
            LAMBDA_ROLE_ARN="arn:aws:iam::${AWS_ACCOUNT_ID}:role/${LAMBDA_ROLE_NAME}"
            
            # Use public LibreOffice layer
            LIBREOFFICE_LAYER_ARN="arn:aws:lambda:${AWS_REGION}:764866452798:layer:libreoffice:1"
            
            # Prepare environment variables
            ENV_VARS="KNOWLEDGE_BASE_ID=$KNOWLEDGE_BASE_ID"
            if [ -n "$DATA_SOURCE_ID" ]; then
                ENV_VARS="$ENV_VARS,DATA_SOURCE_ID=$DATA_SOURCE_ID"
            fi
            
            if aws lambda get-function --function-name $LAMBDA_FUNCTION_NAME --region $AWS_REGION >/dev/null 2>&1; then
                print_status "Updating existing Lambda function..."
                
                # Update function code
                aws lambda update-function-code \
                    --function-name $LAMBDA_FUNCTION_NAME \
                    --zip-file fileb://lambda/document-processor.zip \
                    --region $AWS_REGION >/dev/null
                
                # Update environment variables
                aws lambda update-function-configuration \
                    --function-name $LAMBDA_FUNCTION_NAME \
                    --environment Variables="{$ENV_VARS}" \
                    --region $AWS_REGION >/dev/null
                
                # Update layers
                aws lambda update-function-configuration \
                    --function-name $LAMBDA_FUNCTION_NAME \
                    --layers $LIBREOFFICE_LAYER_ARN \
                    --region $AWS_REGION >/dev/null
                    
            else
                print_status "Creating Lambda function..."
                aws lambda create-function \
                    --function-name $LAMBDA_FUNCTION_NAME \
                    --runtime python3.12 \
                    --role $LAMBDA_ROLE_ARN \
                    --handler lambda_function.lambda_handler \
                    --zip-file fileb://lambda/document-processor.zip \
                    --timeout 300 \
                    --memory-size 1024 \
                    --environment Variables="{$ENV_VARS}" \
                    --layers $LIBREOFFICE_LAYER_ARN \
                    --region $AWS_REGION >/dev/null
            fi
            
            print_status "Lambda function deployed successfully!"
            
            # Create S3 trigger
            print_status "Creating S3 trigger for Lambda function..."
            
            # Add permission for S3 to invoke Lambda
            aws lambda add-permission \
                --function-name $LAMBDA_FUNCTION_NAME \
                --principal s3.amazonaws.com \
                --action lambda:InvokeFunction \
                --source-arn arn:aws:s3:::$DOCUMENTS_BUCKET \
                --statement-id s3-trigger-permission \
                --region $AWS_REGION >/dev/null 2>&1 || true
            
            # Create S3 notification configuration
            cat > s3-notification.json << EOF
{
  "LambdaConfigurations": [
    {
      "Id": "iecho-document-processor-trigger",
      "LambdaFunctionArn": "arn:aws:lambda:${AWS_REGION}:${AWS_ACCOUNT_ID}:function:${LAMBDA_FUNCTION_NAME}",
      "Events": ["s3:ObjectCreated:*"],
      "Filter": {
        "Key": {
          "FilterRules": [
            {
              "Name": "prefix",
              "Value": "uploads/"
            }
          ]
        }
      }
    }
  ]
}
EOF

            # Apply S3 notification configuration
            aws s3api put-bucket-notification-configuration \
                --bucket $DOCUMENTS_BUCKET \
                --notification-configuration file://s3-notification.json \
                --region $AWS_REGION
            
            print_status "S3 trigger configured successfully!"
            
            # Clean up temporary files
            rm -f lambda-trust-policy.json lambda-execution-policy.json s3-notification.json
        else
            print_error "Lambda deployment package not found. Skipping Lambda deployment."
            DEPLOY_LAMBDA=false
        fi
    else
        print_error "Cannot deploy Lambda: Missing Documents Bucket"
        DEPLOY_LAMBDA=false
    fi
fi
# Step 10: Test the endpoints
print_action "Step 10: Testing endpoints..."

if [ -n "$ALB_URL" ]; then
    echo "Testing ALB health endpoint..."
    curl -s "http://$ALB_URL/health" --connect-timeout 10 | jq . || echo "ALB health check failed - may still be provisioning"
    
    echo -e "\nTesting ALB status endpoint..."
    curl -s "http://$ALB_URL/status" --connect-timeout 10 | jq . || echo "ALB status check failed - may still be provisioning"
fi

if [ -n "$API_GATEWAY_URL" ]; then
    echo -e "\nTesting API Gateway health endpoint..."
    curl -s "$API_GATEWAY_URL/health" --connect-timeout 10 | jq . || echo "API Gateway health check failed"
    
    echo -e "\nTesting API Gateway status endpoint..."
    curl -s "$API_GATEWAY_URL/status" --connect-timeout 10 | jq . || echo "API Gateway status check failed"
fi

print_status "🎉 Unified deployment completed successfully!"
echo ""
echo "📋 Deployment Summary:"
echo "======================"
echo "✅ EKS Auto Mode cluster: $CLUSTER_NAME"
echo "✅ S3 bucket: $DOCUMENTS_BUCKET"
echo "✅ DynamoDB table: $FEEDBACK_TABLE_NAME"
echo "✅ Knowledge Base ID: $KNOWLEDGE_BASE_ID"
echo "✅ ECR repository: $AWS_ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com/$ECR_REPOSITORY"

if [ -n "$ALB_URL" ]; then
    echo "✅ Application Load Balancer: http://$ALB_URL"
fi

if [ -n "$API_GATEWAY_URL" ]; then
    echo "✅ API Gateway: $API_GATEWAY_URL"
fi

if [ "$DEPLOY_LAMBDA" = true ]; then
    echo "✅ Lambda Function: iecho-document-processor (PPT to PDF conversion)"
fi

echo ""
echo "🔗 Access Methods:"

if [ -n "$ALB_URL" ]; then
    echo "📡 Direct ALB Access:"
    echo "  Health: http://$ALB_URL/health"
    echo "  Status: http://$ALB_URL/status"
    echo "  Chat: http://$ALB_URL/chat (POST)"
    echo "  Feedback: http://$ALB_URL/feedback (POST)"
    echo "  Documents: http://$ALB_URL/documents (GET)"
fi

if [ -n "$API_GATEWAY_URL" ]; then
    echo ""
    echo "🌐 API Gateway Access (Recommended for Production):"
    echo "  Health: $API_GATEWAY_URL/health"
    echo "  Status: $API_GATEWAY_URL/status"
    echo "  Chat: $API_GATEWAY_URL/chat (POST)"
    echo "  Feedback: $API_GATEWAY_URL/feedback (POST)"
    echo "  Documents: $API_GATEWAY_URL/documents (GET)"
fi

echo ""
echo "📝 Next Steps:"

if [ "$DEPLOY_LAMBDA" = true ]; then
    echo "1. Upload documents (PPT files will be auto-converted):"
    echo "   # For PPT files (auto-converted to PDF):"
    echo "   aws s3 cp presentation.pptx s3://$DOCUMENTS_BUCKET/uploads/"
    echo "   # For other formats (moved directly):"
    echo "   aws s3 cp document.pdf s3://$DOCUMENTS_BUCKET/uploads/"
    echo ""
    echo "2. Lambda will automatically:"
    echo "   - Convert PPT/PPTX files to PDF"
    echo "   - Move processed files to s3://$DOCUMENTS_BUCKET/processed/"
    echo "   - Trigger Knowledge Base sync"
else
    echo "1. Upload documents manually:"
    echo "   aws s3 cp your-document.txt s3://$DOCUMENTS_BUCKET/processed/"
    echo ""
    echo "2. Sync Knowledge Base manually:"
    echo "   Go to AWS Console > Bedrock > Knowledge bases > Your KB > Data sources > Sync"
fi

echo ""
echo "3. Test the chat endpoint:"
if [ -n "$API_GATEWAY_URL" ]; then
    echo "   curl -X POST $API_GATEWAY_URL/chat \\"
else
    echo "   curl -X POST http://$ALB_URL/chat \\"
fi
echo "     -H 'Content-Type: application/json' \\"
echo "     -d '{\"query\": \"What is artificial intelligence?\", \"userId\": \"test-user\"}'"

if [ "$DEPLOY_LAMBDA" = true ]; then
    echo ""
    echo "🔍 To monitor Lambda function:"
    echo "  aws logs tail /aws/lambda/iecho-document-processor --follow --region $AWS_REGION"
fi

echo ""
echo "🔍 To monitor EKS:"
echo "  kubectl get pods"
echo "  kubectl logs -l app.kubernetes.io/name=iecho-rag-chatbot"
echo ""
echo "🧹 To cleanup when done:"
echo "  ./cleanup.sh"
echo ""
echo "📚 For troubleshooting, see: TROUBLESHOOTING_FIXES.md"
echo ""
echo "💰 Estimated monthly cost: \$$([ "$DEPLOY_API_GATEWAY" = true ] && echo "125-170" || echo "115-160") (varies with usage)"
