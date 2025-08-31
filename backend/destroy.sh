#!/bin/bash

# Simple destroy script - just clean security groups and run cdk destroy

echo "🧹 Cleaning up security groups before CDK destroy..."

# Delete k8s security groups that block VPC deletion
aws ec2 describe-security-groups --filters "Name=group-name,Values=k8s-*" --query 'SecurityGroups[].GroupId' --output text 2>/dev/null | xargs -r -n1 aws ec2 delete-security-group --group-id 2>/dev/null || true

echo "🚀 Running CDK destroy..."
cdk destroy

echo "✅ Done!"