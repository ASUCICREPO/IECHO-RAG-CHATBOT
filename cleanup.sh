#!/usr/bin/env bash
set -euo pipefail

# --------------------------------------------------
# iECHO RAG Chatbot Cleanup Script
# Usage: ./cleanup.sh
# --------------------------------------------------

echo "🗑️  iECHO RAG Chatbot Cleanup"
echo ""
echo "This will destroy all iECHO resources and CodeBuild projects."
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

# Find and delete all iECHO CodeBuild projects
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

# Find and delete source buckets
SOURCE_BUCKETS=$(aws s3api list-buckets --query 'Buckets[?contains(Name, `codebuild-source`) || contains(Name, `frontend-source`)].Name' --output text)

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
# 3. Run infrastructure destroy
# --------------------------------------------------

echo "🚀 Starting infrastructure destroy..."

# Call the main deployment script with destroy action
./deploy.sh destroy

exit 0
