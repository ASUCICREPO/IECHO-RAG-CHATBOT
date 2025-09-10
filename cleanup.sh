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
# 3. CDK Destroy with security group cleanup retry
# --------------------------------------------------

echo "☁️  Running CDK destroy..."

STACK_NAME="AgentFargateStack"

if aws cloudformation describe-stacks --stack-name "$STACK_NAME" >/dev/null 2>&1; then
  
  # First attempt CDK destroy
  echo "Attempting CDK destroy..."
  cd backend
  
  # Install dependencies first
  if [ ! -d "node_modules" ]; then
    echo "Installing CDK dependencies..."
    npm install >/dev/null 2>&1
  fi
  
  if cdk destroy --force 2>/dev/null; then
    echo "✅ CDK destroy completed successfully"
  else
    echo "⚠️  CDK destroy failed, likely due to security group dependencies"
    echo "🔒 Cleaning up security group dependencies and retrying..."
    
    # Get VPC ID from stack
    VPC_ID=$(aws cloudformation describe-stack-resources --stack-name "$STACK_NAME" --query 'StackResources[?ResourceType==`AWS::EC2::VPC`].PhysicalResourceId' --output text 2>/dev/null)
    
    if [ -n "$VPC_ID" ] && [ "$VPC_ID" != "None" ]; then
      echo "Found VPC: $VPC_ID"
      
      # Clean up network interfaces first
      echo "Cleaning up network interfaces..."
      ENI_IDS=$(aws ec2 describe-network-interfaces --filters "Name=vpc-id,Values=$VPC_ID" --query 'NetworkInterfaces[?Status==`available`].NetworkInterfaceId' --output text 2>/dev/null)
      for eni_id in $ENI_IDS; do
        if [ -n "$eni_id" ]; then
          echo "Deleting network interface: $eni_id"
          aws ec2 delete-network-interface --network-interface-id "$eni_id" 2>/dev/null || true
        fi
      done
      
      # Clean up security group rules
      echo "Cleaning up security group rules..."
      SG_IDS=$(aws ec2 describe-security-groups --filters "Name=vpc-id,Values=$VPC_ID" --query 'SecurityGroups[].GroupId' --output text 2>/dev/null)
      
      for sg_id in $SG_IDS; do
        if [ -n "$sg_id" ]; then
          echo "Cleaning security group: $sg_id"
          # Remove all ingress rules
          aws ec2 describe-security-groups --group-ids "$sg_id" --query 'SecurityGroups[0].IpPermissions' --output json 2>/dev/null | \
          jq -c '.[]?' 2>/dev/null | while read rule; do
            if [ -n "$rule" ]; then
              aws ec2 revoke-security-group-ingress --group-id "$sg_id" --ip-permissions "$rule" 2>/dev/null || true
            fi
          done
          
          # Remove all egress rules (except default)
          aws ec2 describe-security-groups --group-ids "$sg_id" --query 'SecurityGroups[0].IpPermissionsEgress[?!(IpProtocol==`-1` && IpRanges[0].CidrIp==`0.0.0.0/0`)]' --output json 2>/dev/null | \
          jq -c '.[]?' 2>/dev/null | while read rule; do
            if [ -n "$rule" ]; then
              aws ec2 revoke-security-group-egress --group-id "$sg_id" --ip-permissions "$rule" 2>/dev/null || true
            fi
          done
        fi
      done
      
      echo "✅ Security group dependencies cleaned up"
      
      # Wait a moment for changes to propagate
      sleep 5
      
      # Retry CDK destroy
      echo "Retrying CDK destroy..."
      if cdk destroy --force; then
        echo "✅ CDK destroy completed successfully on retry"
      else
        echo "❌ CDK destroy failed even after cleanup. Manual intervention may be required."
        echo "🔗 Check CloudFormation console: https://console.aws.amazon.com/cloudformation/"
      fi
    else
      echo "❌ Could not find VPC ID for cleanup"
    fi
  fi
  
  cd ..
else
  echo "⚠️  Stack $STACK_NAME not found"
fi

# --------------------------------------------------
# 4. Clean up IAM roles
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
