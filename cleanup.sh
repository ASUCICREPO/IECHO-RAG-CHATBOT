#!/usr/bin/env bash
set -euo pipefail

# --------------------------------------------------
# iECHO RAG Chatbot Cleanup Script
# Usage: ./cleanup.sh
# --------------------------------------------------

echo "🗑️  iECHO RAG Chatbot Cleanup"
echo ""
echo "This will destroy all iECHO resources using direct AWS CLI commands."
echo ""
read -rp "Are you sure you want to proceed? (y/N): " confirm

if [[ ! "$confirm" =~ ^[Yy]$ ]]; then
  echo "Cleanup cancelled."
  exit 0
fi

echo ""
echo "🧹 Starting cleanup..."

# --------------------------------------------------
# 1. Clean up CodeBuild projects
# --------------------------------------------------

echo "🔨 Cleaning up CodeBuild projects..."

CODEBUILD_PROJECTS=$(aws codebuild list-projects --query 'projects[?contains(@, `iecho-rag`)]' --output text)

if [ -n "$CODEBUILD_PROJECTS" ]; then
  for project in $CODEBUILD_PROJECTS; do
    echo "Deleting CodeBuild project: $project"
    aws codebuild delete-project --name "$project" >/dev/null 2>&1 || echo "Failed to delete $project"
  done
  echo "✅ CodeBuild projects cleaned up"
else
  echo "⚠️  No iECHO CodeBuild projects found"
fi

# --------------------------------------------------
# 2. Clean up S3 source buckets
# --------------------------------------------------

echo "🪣 Cleaning up S3 source buckets..."

SOURCE_BUCKETS=$(aws s3api list-buckets --query 'Buckets[?contains(Name, `codebuild-source`)].Name' --output text)

if [ -n "$SOURCE_BUCKETS" ]; then
  for bucket in $SOURCE_BUCKETS; do
    echo "Emptying and deleting S3 bucket: $bucket"
    aws s3 rm s3://$bucket --recursive >/dev/null 2>&1 || echo "Bucket already empty"
    aws s3 rb s3://$bucket >/dev/null 2>&1 || echo "Bucket deletion failed"
  done
  echo "✅ Source buckets cleaned up"
else
  echo "⚠️  No source buckets found"
fi

# --------------------------------------------------
# 3. Clean up security group dependencies
# --------------------------------------------------

echo "🔒 Cleaning up security group dependencies..."

STACK_NAME="AgentFargateStack"

if aws cloudformation describe-stacks --stack-name "$STACK_NAME" >/dev/null 2>&1; then
  VPC_ID=$(aws cloudformation describe-stack-resources --stack-name "$STACK_NAME" --query 'StackResources[?ResourceType==`AWS::EC2::VPC`].PhysicalResourceId' --output text 2>/dev/null)
  
  if [ -n "$VPC_ID" ] && [ "$VPC_ID" != "None" ]; then
    echo "Found VPC: $VPC_ID"
    
    SG_IDS=$(aws ec2 describe-security-groups --filters "Name=vpc-id,Values=$VPC_ID" --query 'SecurityGroups[].GroupId' --output text 2>/dev/null)
    
    for sg_id in $SG_IDS; do
      if [ -n "$sg_id" ]; then
        echo "Cleaning security group: $sg_id"
        # Remove ingress rules that reference other security groups
        aws ec2 describe-security-groups --group-ids "$sg_id" --query 'SecurityGroups[0].IpPermissions[?UserIdGroupPairs]' --output json 2>/dev/null | \
        jq -c '.[]?' 2>/dev/null | while read rule; do
          if [ -n "$rule" ]; then
            aws ec2 revoke-security-group-ingress --group-id "$sg_id" --ip-permissions "$rule" 2>/dev/null || true
          fi
        done
        
        # Remove egress rules that reference other security groups  
        aws ec2 describe-security-groups --group-ids "$sg_id" --query 'SecurityGroups[0].IpPermissionsEgress[?UserIdGroupPairs]' --output json 2>/dev/null | \
        jq -c '.[]?' 2>/dev/null | while read rule; do
          if [ -n "$rule" ]; then
            aws ec2 revoke-security-group-egress --group-id "$sg_id" --ip-permissions "$rule" 2>/dev/null || true
          fi
        done
      fi
    done
    
    echo "✅ Security group dependencies cleaned up"
  fi
fi

# --------------------------------------------------
# 4. Delete CloudFormation stack
# --------------------------------------------------

echo "☁️  Deleting CloudFormation stack..."

if aws cloudformation describe-stacks --stack-name "$STACK_NAME" >/dev/null 2>&1; then
  echo "Deleting stack: $STACK_NAME"
  aws cloudformation delete-stack --stack-name "$STACK_NAME"
  
  echo "Waiting for stack deletion to complete..."
  aws cloudformation wait stack-delete-complete --stack-name "$STACK_NAME"
  echo "✅ CloudFormation stack deleted successfully"
else
  echo "⚠️  Stack $STACK_NAME not found"
fi

# --------------------------------------------------
# 5. Clean up IAM roles
# --------------------------------------------------

echo "👤 Cleaning up IAM roles..."

IAM_ROLES=$(aws iam list-roles --query 'Roles[?contains(RoleName, `iecho-rag`) && contains(RoleName, `service-role`)].RoleName' --output text)

if [ -n "$IAM_ROLES" ]; then
  for role in $IAM_ROLES; do
    echo "Deleting IAM role: $role"
    aws iam delete-role-policy --role-name "$role" --policy-name "iECHODeploymentPolicy" >/dev/null 2>&1 || true
    aws iam delete-role --role-name "$role" >/dev/null 2>&1 || true
  done
  echo "✅ IAM roles cleaned up"
else
  echo "⚠️  No iECHO IAM roles found"
fi

echo ""
echo "🎉 Cleanup Complete!"
echo "✅ All iECHO RAG Chatbot resources have been cleaned up successfully!"

exit 0
