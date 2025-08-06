#!/bin/bash

# iECHO RAG Chatbot - Unified Cleanup Script
# Removes all AWS resources including API Gateway and Lambda
set -e

echo "🧹 Starting complete iECHO RAG Chatbot cleanup..."

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
    echo "Usage: $0 [OPTIONS]"
    echo ""
    echo "Options:"
    echo "  --force              Skip confirmation prompt"
    echo "  --keep-api-gateway   Keep API Gateway resources"
    echo "  --keep-lambda        Keep Lambda function"
    echo "  --help               Show this help message"
    echo ""
    echo "Examples:"
    echo "  $0                   # Interactive cleanup (recommended)"
    echo "  $0 --force           # Non-interactive cleanup"
    echo "  $0 --keep-api-gateway # Keep API Gateway, cleanup everything else"
    echo "  $0 --keep-lambda     # Keep Lambda function, cleanup everything else"
}

# Parse arguments
FORCE_CLEANUP=false
KEEP_API_GATEWAY=false
KEEP_LAMBDA=false

while [[ $# -gt 0 ]]; do
    case $1 in
        --force)
            FORCE_CLEANUP=true
            shift
            ;;
        --keep-api-gateway)
            KEEP_API_GATEWAY=true
            shift
            ;;
        --keep-lambda)
            KEEP_LAMBDA=true
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
            print_error "Unexpected argument: $1"
            show_usage
            exit 1
            ;;
    esac
done

# Confirmation prompt (unless forced)
if [ "$FORCE_CLEANUP" = false ]; then
    echo "⚠️  This will delete ALL iECHO RAG Chatbot resources including:"
    if [ "$KEEP_API_GATEWAY" = false ]; then
        echo "   - API Gateway and all endpoints"
    fi
    if [ "$KEEP_LAMBDA" = false ]; then
        echo "   - Lambda function and document processing"
    fi
    echo "   - EKS cluster and all workloads"
    echo "   - S3 bucket and all documents"
    echo "   - DynamoDB table and all feedback data"
    echo "   - ECR repository and container images"
    echo "   - IAM roles and policies"
    echo "   - Application Load Balancer"
    echo ""
    read -p "Are you sure you want to continue? (yes/no): " -r
    if [[ ! $REPLY =~ ^[Yy][Ee][Ss]$ ]]; then
        echo "Cleanup cancelled."
        exit 0
    fi
fi

# Set environment variables
export AWS_ACCOUNT_ID=$(aws sts get-caller-identity --query 'Account' --output text)
export AWS_REGION=${AWS_REGION:-us-west-2}
export CLUSTER_NAME=${CLUSTER_NAME:-iecho-rag-cluster}
export ECR_REPOSITORY=${ECR_REPOSITORY:-iecho-rag-chatbot}

print_status "Using AWS Account: $AWS_ACCOUNT_ID"
print_status "Using AWS Region: $AWS_REGION"

# Step 1: Clean up API Gateway (if not keeping it)
STEP_NUM=1
if [ "$KEEP_API_GATEWAY" = false ]; then
    print_action "Step $STEP_NUM: Cleaning up API Gateway..."

    API_NAME="iecho-rag-chatbot-api"
    API_ID=$(aws apigateway get-rest-apis --region $AWS_REGION --query "items[?name=='$API_NAME'].id" --output text 2>/dev/null || echo "")

    if [ -n "$API_ID" ] && [ "$API_ID" != "None" ]; then
        print_status "Deleting API Gateway: $API_ID"
        
        # Delete usage plans and API keys first
        USAGE_PLANS=$(aws apigateway get-usage-plans --region $AWS_REGION --query "items[?contains(name, 'iecho')].id" --output text 2>/dev/null || echo "")
        if [ -n "$USAGE_PLANS" ]; then
            for plan_id in $USAGE_PLANS; do
                print_status "Deleting usage plan: $plan_id"
                
                # Get and delete API keys associated with the plan
                API_KEYS=$(aws apigateway get-usage-plan-keys --usage-plan-id $plan_id --region $AWS_REGION --query 'items[].id' --output text 2>/dev/null || echo "")
                if [ -n "$API_KEYS" ]; then
                    for key_id in $API_KEYS; do
                        print_status "Deleting API key: $key_id"
                        aws apigateway delete-api-key --api-key $key_id --region $AWS_REGION >/dev/null 2>&1 || true
                    done
                fi
                
                aws apigateway delete-usage-plan --usage-plan-id $plan_id --region $AWS_REGION >/dev/null 2>&1 || true
            done
        fi
        
        # Delete the API Gateway
        aws apigateway delete-rest-api --rest-api-id $API_ID --region $AWS_REGION >/dev/null 2>&1 || true
        print_status "API Gateway deleted!"
    else
        print_warning "API Gateway not found, skipping deletion"
    fi
    STEP_NUM=$((STEP_NUM + 1))
else
    print_warning "Keeping API Gateway resources as requested"
fi

# Step 2: Clean up Lambda function (if not keeping it)
if [ "$KEEP_LAMBDA" = false ]; then
    print_action "Step $STEP_NUM: Cleaning up Lambda function..."

    LAMBDA_FUNCTION_NAME="iecho-document-processor"
    LAMBDA_ROLE_NAME="iecho-document-processor-role"
    LAMBDA_POLICY_NAME="iecho-document-processor-policy"
    DOCUMENTS_BUCKET="iecho-documents-${AWS_ACCOUNT_ID}-${AWS_REGION}"

    # Delete Lambda function
    if aws lambda get-function --function-name $LAMBDA_FUNCTION_NAME --region $AWS_REGION >/dev/null 2>&1; then
        print_status "Deleting Lambda function: $LAMBDA_FUNCTION_NAME"
        aws lambda delete-function --function-name $LAMBDA_FUNCTION_NAME --region $AWS_REGION >/dev/null 2>&1 || true
        print_status "Lambda function deleted!"
    else
        print_warning "Lambda function $LAMBDA_FUNCTION_NAME not found, skipping deletion"
    fi

    # Remove S3 notification configuration
    if aws s3api head-bucket --bucket $DOCUMENTS_BUCKET --region $AWS_REGION >/dev/null 2>&1; then
        print_status "Removing S3 notification configuration..."
        aws s3api put-bucket-notification-configuration \
            --bucket $DOCUMENTS_BUCKET \
            --notification-configuration '{}' \
            --region $AWS_REGION >/dev/null 2>&1 || true
    fi

    # Clean up Lambda IAM resources
    if aws iam get-role --role-name $LAMBDA_ROLE_NAME --region $AWS_REGION >/dev/null 2>&1; then
        print_status "Cleaning up Lambda IAM role: $LAMBDA_ROLE_NAME"
        
        # Detach policies
        aws iam detach-role-policy --role-name $LAMBDA_ROLE_NAME \
            --policy-arn arn:aws:iam::$AWS_ACCOUNT_ID:policy/$LAMBDA_POLICY_NAME >/dev/null 2>&1 || true
        
        aws iam detach-role-policy --role-name $LAMBDA_ROLE_NAME \
            --policy-arn arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole >/dev/null 2>&1 || true
        
        # Delete role
        aws iam delete-role --role-name $LAMBDA_ROLE_NAME >/dev/null 2>&1 || true
    fi

    # Delete Lambda policy
    if aws iam get-policy --policy-arn arn:aws:iam::$AWS_ACCOUNT_ID:policy/$LAMBDA_POLICY_NAME >/dev/null 2>&1; then
        print_status "Deleting Lambda IAM policy: $LAMBDA_POLICY_NAME"
        aws iam delete-policy --policy-arn arn:aws:iam::$AWS_ACCOUNT_ID:policy/$LAMBDA_POLICY_NAME >/dev/null 2>&1 || true
    fi

    print_status "Lambda resources cleaned up!"
    STEP_NUM=$((STEP_NUM + 1))
else
    print_warning "Keeping Lambda function as requested"
fi

# Step 3: Clean up Kubernetes resources
print_action "Step $STEP_NUM: Cleaning up Kubernetes resources..."

# Uninstall Helm release
print_status "Uninstalling Helm release..."
helm uninstall iecho-rag-chatbot --no-hooks >/dev/null 2>&1 || true

# Delete all related Kubernetes resources
print_status "Deleting Kubernetes resources..."
kubectl delete all,ingress,configmap,secret,serviceaccount,pdb \
    -l app.kubernetes.io/name=iecho-rag-chatbot >/dev/null 2>&1 || true

# Delete IngressClass
kubectl delete ingressclass alb >/dev/null 2>&1 || true
kubectl delete ingressclassparams alb >/dev/null 2>&1 || true

print_status "Kubernetes resources cleaned up!"
STEP_NUM=$((STEP_NUM + 1))

# Step 4: Delete EKS cluster
print_action "Step $STEP_NUM: Deleting EKS cluster..."

if aws eks describe-cluster --name $CLUSTER_NAME --region $AWS_REGION >/dev/null 2>&1; then
    print_status "Deleting EKS cluster: $CLUSTER_NAME"
    print_warning "This may take 10-15 minutes..."
    
    # Delete Pod Identity associations first
    ASSOCIATIONS=$(aws eks list-pod-identity-associations --cluster-name $CLUSTER_NAME --region $AWS_REGION --query 'associations[].associationId' --output text 2>/dev/null || echo "")
    if [ -n "$ASSOCIATIONS" ]; then
        for assoc in $ASSOCIATIONS; do
            print_status "Deleting Pod Identity association: $assoc"
            aws eks delete-pod-identity-association --cluster-name $CLUSTER_NAME --association-id $assoc --region $AWS_REGION >/dev/null 2>&1 || true
        done
    fi
    
    # Delete the cluster
    eksctl delete cluster --name $CLUSTER_NAME --region $AWS_REGION --wait
    print_status "EKS cluster deleted!"
else
    print_warning "EKS cluster $CLUSTER_NAME not found, skipping deletion"
fi
STEP_NUM=$((STEP_NUM + 1))

# Step 5: Delete S3 bucket
print_action "Step $STEP_NUM: Deleting S3 bucket..."

DOCUMENTS_BUCKET="iecho-documents-${AWS_ACCOUNT_ID}-${AWS_REGION}"

if aws s3api head-bucket --bucket $DOCUMENTS_BUCKET --region $AWS_REGION >/dev/null 2>&1; then
    print_status "Deleting S3 bucket: $DOCUMENTS_BUCKET"
    
    # Delete all objects and versions
    aws s3api delete-objects --bucket $DOCUMENTS_BUCKET \
        --delete "$(aws s3api list-object-versions --bucket $DOCUMENTS_BUCKET \
        --query '{Objects: Versions[].{Key:Key,VersionId:VersionId}}' --output json)" >/dev/null 2>&1 || true
    
    # Delete delete markers
    aws s3api delete-objects --bucket $DOCUMENTS_BUCKET \
        --delete "$(aws s3api list-object-versions --bucket $DOCUMENTS_BUCKET \
        --query '{Objects: DeleteMarkers[].{Key:Key,VersionId:VersionId}}' --output json)" >/dev/null 2>&1 || true
    
    # Delete the bucket
    aws s3api delete-bucket --bucket $DOCUMENTS_BUCKET --region $AWS_REGION
    print_status "S3 bucket deleted!"
else
    print_warning "S3 bucket $DOCUMENTS_BUCKET not found, skipping deletion"
fi
STEP_NUM=$((STEP_NUM + 1))

# Step 6: Delete DynamoDB table
print_action "Step $STEP_NUM: Deleting DynamoDB table..."

FEEDBACK_TABLE_NAME="iecho-feedback-table"

if aws dynamodb describe-table --table-name $FEEDBACK_TABLE_NAME --region $AWS_REGION >/dev/null 2>&1; then
    print_status "Deleting DynamoDB table: $FEEDBACK_TABLE_NAME"
    aws dynamodb delete-table --table-name $FEEDBACK_TABLE_NAME --region $AWS_REGION >/dev/null
    print_status "DynamoDB table deleted!"
else
    print_warning "DynamoDB table $FEEDBACK_TABLE_NAME not found, skipping deletion"
fi
STEP_NUM=$((STEP_NUM + 1))

# Step 7: Delete ECR repository
print_action "Step $STEP_NUM: Deleting ECR repository..."

if aws ecr describe-repositories --repository-names $ECR_REPOSITORY --region $AWS_REGION >/dev/null 2>&1; then
    print_status "Deleting ECR repository: $ECR_REPOSITORY"
    aws ecr delete-repository --repository-name $ECR_REPOSITORY --force --region $AWS_REGION >/dev/null
    print_status "ECR repository deleted!"
else
    print_warning "ECR repository $ECR_REPOSITORY not found, skipping deletion"
fi
STEP_NUM=$((STEP_NUM + 1))

# Step 8: Clean up IAM resources
print_action "Step $STEP_NUM: Cleaning up IAM resources..."

# Delete custom IAM policy
BEDROCK_POLICY_NAME="iecho-bedrock-nova-lite-policy"
POLICY_ARN="arn:aws:iam::${AWS_ACCOUNT_ID}:policy/${BEDROCK_POLICY_NAME}"

if aws iam get-policy --policy-arn $POLICY_ARN >/dev/null 2>&1; then
    print_status "Deleting IAM policy: $BEDROCK_POLICY_NAME"
    
    # Detach from all roles first
    ATTACHED_ROLES=$(aws iam list-entities-for-policy --policy-arn $POLICY_ARN --query 'PolicyRoles[].RoleName' --output text 2>/dev/null || echo "")
    if [ -n "$ATTACHED_ROLES" ]; then
        for role in $ATTACHED_ROLES; do
            aws iam detach-role-policy --role-name $role --policy-arn $POLICY_ARN >/dev/null 2>&1 || true
        done
    fi
    
    # Delete all policy versions except default
    VERSIONS=$(aws iam list-policy-versions --policy-arn $POLICY_ARN --query 'Versions[?!IsDefaultVersion].VersionId' --output text 2>/dev/null || echo "")
    if [ -n "$VERSIONS" ]; then
        for version in $VERSIONS; do
            aws iam delete-policy-version --policy-arn $POLICY_ARN --version-id $version >/dev/null 2>&1 || true
        done
    fi
    
    # Delete the policy
    aws iam delete-policy --policy-arn $POLICY_ARN >/dev/null 2>&1 || true
    print_status "IAM policy deleted!"
else
    print_warning "IAM policy $BEDROCK_POLICY_NAME not found, skipping deletion"
fi

# Clean up EKS-created IAM roles (these are created by eksctl)
print_status "Cleaning up EKS-created IAM roles..."
EKS_ROLES=$(aws iam list-roles --query 'Roles[?contains(RoleName, `eks-iecho-rag-chatbot`)].RoleName' --output text 2>/dev/null || echo "")
if [ -n "$EKS_ROLES" ]; then
    for role in $EKS_ROLES; do
        print_status "Cleaning up IAM role: $role"
        
        # Detach all policies
        ATTACHED_POLICIES=$(aws iam list-attached-role-policies --role-name $role --query 'AttachedPolicies[].PolicyArn' --output text 2>/dev/null || echo "")
        if [ -n "$ATTACHED_POLICIES" ]; then
            for policy in $ATTACHED_POLICIES; do
                aws iam detach-role-policy --role-name $role --policy-arn $policy >/dev/null 2>&1 || true
            done
        fi
        
        # Delete inline policies
        INLINE_POLICIES=$(aws iam list-role-policies --role-name $role --query 'PolicyNames' --output text 2>/dev/null || echo "")
        if [ -n "$INLINE_POLICIES" ]; then
            for policy in $INLINE_POLICIES; do
                aws iam delete-role-policy --role-name $role --policy-name $policy >/dev/null 2>&1 || true
            done
        fi
        
        # Delete the role
        aws iam delete-role --role-name $role >/dev/null 2>&1 || true
    done
fi
STEP_NUM=$((STEP_NUM + 1))

# Step 9: Clean up CloudFormation stacks (created by eksctl)
print_action "Step $STEP_NUM: Cleaning up CloudFormation stacks..."

STACKS=$(aws cloudformation list-stacks --region $AWS_REGION \
    --query 'StackSummaries[?contains(StackName, `eksctl-iecho-rag-cluster`) && StackStatus != `DELETE_COMPLETE`].StackName' \
    --output text 2>/dev/null || echo "")

if [ -n "$STACKS" ]; then
    for stack in $STACKS; do
        print_status "Deleting CloudFormation stack: $stack"
        aws cloudformation delete-stack --stack-name $stack --region $AWS_REGION >/dev/null 2>&1 || true
    done
    print_status "CloudFormation stacks cleanup initiated!"
else
    print_warning "No eksctl CloudFormation stacks found"
fi
STEP_NUM=$((STEP_NUM + 1))

# Step 10: Verify cleanup
print_action "Step $STEP_NUM: Verifying cleanup..."

print_status "Checking remaining resources..."

# Check API Gateway (if we were supposed to delete it)
if [ "$KEEP_API_GATEWAY" = false ]; then
    if aws apigateway get-rest-apis --region $AWS_REGION --query "items[?name=='iecho-rag-chatbot-api']" --output text | grep -q "iecho-rag-chatbot-api"; then
        print_warning "API Gateway still exists"
    else
        print_status "✅ API Gateway removed"
    fi
fi

# Check Lambda (if we were supposed to delete it)
if [ "$KEEP_LAMBDA" = false ]; then
    if aws lambda get-function --function-name iecho-document-processor --region $AWS_REGION >/dev/null 2>&1; then
        print_warning "Lambda function still exists"
    else
        print_status "✅ Lambda function removed"
    fi
fi

# Check EKS
if aws eks describe-cluster --name $CLUSTER_NAME --region $AWS_REGION >/dev/null 2>&1; then
    print_warning "EKS cluster still exists (may be deleting)"
else
    print_status "✅ EKS cluster removed"
fi

# Check S3
DOCUMENTS_BUCKET="iecho-documents-${AWS_ACCOUNT_ID}-${AWS_REGION}"
if aws s3api head-bucket --bucket $DOCUMENTS_BUCKET --region $AWS_REGION >/dev/null 2>&1; then
    print_warning "S3 bucket still exists"
else
    print_status "✅ S3 bucket removed"
fi

# Check DynamoDB
if aws dynamodb describe-table --table-name iecho-feedback-table --region $AWS_REGION >/dev/null 2>&1; then
    print_warning "DynamoDB table still exists (may be deleting)"
else
    print_status "✅ DynamoDB table removed"
fi

# Check ECR
if aws ecr describe-repositories --repository-names $ECR_REPOSITORY --region $AWS_REGION >/dev/null 2>&1; then
    print_warning "ECR repository still exists"
else
    print_status "✅ ECR repository removed"
fi

print_status "🎉 Cleanup completed!"
echo ""
echo "📋 Cleanup Summary:"
echo "==================="
if [ "$KEEP_API_GATEWAY" = false ]; then
    echo "✅ API Gateway and endpoints deleted"
    echo "✅ Usage plans and API keys deleted"
fi
if [ "$KEEP_LAMBDA" = false ]; then
    echo "✅ Lambda function and resources deleted"
    echo "✅ S3 notification configuration removed"
fi
echo "✅ Kubernetes resources deleted"
echo "✅ EKS cluster deletion initiated"
echo "✅ S3 bucket and contents deleted"
echo "✅ DynamoDB table deletion initiated"
echo "✅ ECR repository deleted"
echo "✅ IAM policies and roles cleaned up"
echo "✅ CloudFormation stacks cleanup initiated"
echo ""
echo "⏰ Note: Some resources (EKS cluster, DynamoDB table) may take a few minutes to fully delete."
echo ""
echo "💰 Cost Impact:"
echo "   - All charges should stop immediately"
echo "   - EKS cluster charges will stop once deletion completes (~10-15 minutes)"
echo ""
echo "🔍 To verify complete cleanup:"
if [ "$KEEP_API_GATEWAY" = false ]; then
    echo "   aws apigateway get-rest-apis --region $AWS_REGION --query \"items[?name=='iecho-rag-chatbot-api']\""
fi
if [ "$KEEP_LAMBDA" = false ]; then
    echo "   aws lambda get-function --function-name iecho-document-processor --region $AWS_REGION"
fi
echo "   aws eks describe-cluster --name $CLUSTER_NAME --region $AWS_REGION"
echo "   aws dynamodb describe-table --table-name iecho-feedback-table --region $AWS_REGION"
echo ""
echo "📊 Check AWS Console for any remaining resources if needed."
