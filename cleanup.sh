#!/usr/bin/env bash
set -euo pipefail

# --------------------------------------------------
# iECHO RAG Chatbot Cleanup Script
# Usage: ./cleanup.sh
# --------------------------------------------------

echo "🗑️  iECHO RAG Chatbot Cleanup"
echo ""
echo "This will destroy all iECHO resources using the main deployment script."
echo ""
read -rp "Are you sure you want to proceed? (y/N): " confirm

if [[ ! "$confirm" =~ ^[Yy]$ ]]; then
  echo "Cleanup cancelled."
  exit 0
fi

echo ""
echo "🧹 Starting cleanup..."

# --------------------------------------------------
# 1. Clean up CodeBuild projects first
# --------------------------------------------------

echo "🔨 Cleaning up existing CodeBuild projects..."

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
# 2. Run infrastructure destroy via buildspec
# --------------------------------------------------

echo "🚀 Starting infrastructure destroy via buildspec..."

# Call the main deployment script with destroy action
./deploy.sh destroy

exit 0
