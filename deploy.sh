#!/usr/bin/env bash
set -euo pipefail

# Prompt for action first
if [ -z "${ACTION:-}" ]; then
  while true; do
    read -rp "Deploy or destroy? [deploy/destroy]: " ACTION
    ACTION=$(printf '%s' "$ACTION" | tr '[:upper:]' '[:lower:]')
    if [ "$ACTION" = "deploy" ] || [ "$ACTION" = "destroy" ]; then
      break
    fi
    echo "Error: Please enter 'deploy' or 'destroy'"
  done
fi

# Skip GitHub setup for destroy
if [ "$ACTION" != "destroy" ]; then
  # Prompt for GitHub URL
  if [ -z "${GITHUB_URL:-}" ]; then
    read -rp "Enter GitHub repository URL (e.g. https://github.com/OWNER/REPO): " GITHUB_URL
  fi

  # Extract owner/repo from URL
  clean_url=${GITHUB_URL%.git}
  clean_url=${clean_url%/}

  if [[ $clean_url =~ ^https://github\.com/([^/]+/[^/]+)$ ]]; then
    path="${BASH_REMATCH[1]}"
  elif [[ $clean_url =~ ^git@github\.com:([^/]+/[^/]+)$ ]]; then
    path="${BASH_REMATCH[1]}"
  else
    echo "Unable to parse owner/repo from '$GITHUB_URL'"
    read -rp "Enter GitHub owner manually: " GITHUB_OWNER
    read -rp "Enter GitHub repo manually: " GITHUB_REPO
    echo "→ Using GITHUB_OWNER=$GITHUB_OWNER"
    echo "→ Using GITHUB_REPO=$GITHUB_REPO"
  fi

  if [ -n "${path:-}" ]; then
    # Split into owner and repo
    GITHUB_OWNER=${path%%/*}
    GITHUB_REPO=${path##*/}

    # Confirm detection
    echo "Detected GitHub Owner: $GITHUB_OWNER"
    echo "Detected GitHub Repo: $GITHUB_REPO"
    read -rp "Is this correct? (y/n): " CONFIRM
    CONFIRM=$(printf '%s' "$CONFIRM" | tr '[:upper:]' '[:lower:]')

    if [[ "$CONFIRM" != "y" && "$CONFIRM" != "yes" ]]; then
      read -rp "Enter GitHub owner manually: " GITHUB_OWNER
      read -rp "Enter GitHub repo manually: " GITHUB_REPO
    fi

    echo "→ Final GITHUB_OWNER=$GITHUB_OWNER"
    echo "→ Final GITHUB_REPO=$GITHUB_REPO"
  fi
fi

if [ -z "${PROJECT_NAME:-}" ]; then
  while true; do
    read -rp "Enter CodeBuild project name: " PROJECT_NAME
    if [[ "$PROJECT_NAME" =~ ^[a-zA-Z0-9][a-zA-Z0-9_-]{1,254}$ ]]; then
      break
    fi
    echo "Error: Project name must be 2-255 chars, start with alphanumeric, contain only letters, numbers, hyphens, underscores"
  done
fi

# Only prompt for deployment inputs if not destroying
if [ "$ACTION" != "destroy" ]; then
  if [ -z "${KNOWLEDGE_BASE_ID:-}" ]; then
    while true; do
      read -rp "Enter Bedrock Knowledge Base ID: " KNOWLEDGE_BASE_ID
      if [[ "$KNOWLEDGE_BASE_ID" =~ ^[A-Z0-9]{10}$ ]]; then
        break
      fi
      echo "Error: Knowledge Base ID should be 10 uppercase alphanumeric characters (e.g., ABC123DEF4)"
    done
  fi

  if [ -z "${DOCUMENTS_BUCKET:-}" ]; then
    read -rp "Enter S3 documents bucket (optional): " DOCUMENTS_BUCKET
  fi
fi

# Skip GitHub token and setup for destroy
if [ "$ACTION" != "destroy" ]; then
  if [ -z "${GITHUB_TOKEN:-}" ]; then
    read -rp "Enter GitHub personal access token (repo permissions): " GITHUB_TOKEN
  fi

  # Create IAM service role
  ROLE_NAME="${PROJECT_NAME}-service-role"
  echo "Checking for IAM role: $ROLE_NAME"

  if aws iam get-role --role-name "$ROLE_NAME" >/dev/null 2>&1; then
    echo "✓ IAM role exists"
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

    aws iam attach-role-policy \
      --role-name "$ROLE_NAME" \
      --policy-arn arn:aws:iam::aws:policy/AdministratorAccess

    echo "✓ IAM role created"
    sleep 10
  fi

  # Store GitHub token in Secrets Manager for CDK
  echo "Storing GitHub token in Secrets Manager..."
  aws secretsmanager create-secret \
    --name github-access-token \
    --secret-string "$GITHUB_TOKEN" \
    --description "GitHub access token for Amplify" 2>/dev/null || \
  aws secretsmanager update-secret \
    --secret-id github-access-token \
    --secret-string "$GITHUB_TOKEN"

  # Import GitHub OAuth credentials for CodeBuild
  echo "Setting up GitHub OAuth credentials..."
  aws codebuild import-source-credentials \
    --server-type GITHUB \
    --auth-type PERSONAL_ACCESS_TOKEN \
    --token "$GITHUB_TOKEN" || echo "Credentials already exist or failed to import"
else
  echo "Destroy mode - skipping GitHub setup"
fi

# Create or update CodeBuild project
echo "Setting up CodeBuild project: $PROJECT_NAME"

if [ "$ACTION" = "destroy" ]; then
  # For destroy, just update ACTION environment variable
  ENVIRONMENT='{
    "type": "LINUX_CONTAINER",
    "image": "aws/codebuild/amazonlinux-x86_64-standard:5.0",
    "computeType": "BUILD_GENERAL1_SMALL",
    "environmentVariables": [
      {
        "name": "ACTION",
        "value": "destroy",
        "type": "PLAINTEXT"
      }
    ]
  }'
  
  aws codebuild update-project \
    --name "$PROJECT_NAME" \
    --environment "$ENVIRONMENT" \
    --no-cli-pager >/dev/null
  echo "✓ Updated project for destroy"
else

ENVIRONMENT='{
  "type": "LINUX_CONTAINER",
  "image": "aws/codebuild/amazonlinux-x86_64-standard:5.0",
  "computeType": "BUILD_GENERAL1_SMALL",
  "environmentVariables": [
    {
      "name": "KNOWLEDGE_BASE_ID",
      "value": "'"$KNOWLEDGE_BASE_ID"'",
      "type": "PLAINTEXT"
    },
    {
      "name": "GITHUB_OWNER",
      "value": "'"$GITHUB_OWNER"'",
      "type": "PLAINTEXT"
    },
    {
      "name": "GITHUB_REPO",
      "value": "'"$GITHUB_REPO"'",
      "type": "PLAINTEXT"
    },
    {
      "name": "DOCUMENTS_BUCKET",
      "value": "'"$DOCUMENTS_BUCKET"'",
      "type": "PLAINTEXT"
    },
    {
      "name": "ACTION",
      "value": "'"$ACTION"'",
      "type": "PLAINTEXT"
    }
  ]
}'

ARTIFACTS='{"type":"NO_ARTIFACTS"}'
SOURCE='{"type":"GITHUB","location":"'"$GITHUB_URL"'"}'

if aws codebuild batch-get-projects --names "$PROJECT_NAME" --query 'projects[0].name' --output text 2>/dev/null | grep -q "$PROJECT_NAME"; then
  echo "Updating existing project..."
  aws codebuild update-project \
    --name "$PROJECT_NAME" \
    --source "$SOURCE" \
    --artifacts "$ARTIFACTS" \
    --environment "$ENVIRONMENT" \
    --service-role "$ROLE_ARN" \
    --no-cli-pager >/dev/null
  echo "✓ CodeBuild project updated"
else
  echo "Creating new project..."
  aws codebuild create-project \
    --name "$PROJECT_NAME" \
    --source "$SOURCE" \
    --artifacts "$ARTIFACTS" \
    --environment "$ENVIRONMENT" \
    --service-role "$ROLE_ARN" \
    --source-version "main" \
    --output json \
    --no-cli-pager >/dev/null
  echo "✓ CodeBuild project created"
  fi
fi

# Start the build
echo "Starting build..."
BUILD_ID=$(aws codebuild start-build \
  --project-name "$PROJECT_NAME" \
  --source-version "main" \
  --query 'build.id' \
  --output text)

echo "✓ Build started: $BUILD_ID"
echo "Streaming logs..."
echo "==========================================="

# Stream logs and monitor build status
{
  aws logs tail "/aws/codebuild/$PROJECT_NAME" \
    --follow \
    --format short &
  LOG_PID=$!
  
  # Monitor build status
  while true; do
    STATUS=$(aws codebuild batch-get-builds --ids "$BUILD_ID" --query 'builds[0].buildStatus' --output text 2>/dev/null)
    if [ "$STATUS" = "SUCCEEDED" ] || [ "$STATUS" = "FAILED" ] || [ "$STATUS" = "STOPPED" ]; then
      sleep 5  # Allow final logs to stream
      kill $LOG_PID 2>/dev/null
      echo ""
      echo "==========================================="
      if [ "$ACTION" = "destroy" ]; then
        echo "✓ Infrastructure destroyed with status: $STATUS"
      else
        echo "✓ Build completed with status: $STATUS"
      fi
      break
    fi
    sleep 10
  done
}