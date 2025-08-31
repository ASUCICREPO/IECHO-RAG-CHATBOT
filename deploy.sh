#!/usr/bin/env bash
set -euo pipefail

# Prompt for action first
if [ -z "${ACTION:-}" ]; then
  read -rp "Deploy or destroy? [deploy/destroy]: " ACTION
  ACTION=$(printf '%s' "$ACTION" | tr '[:upper:]' '[:lower:]')
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
  read -rp "Enter CodeBuild project name: " PROJECT_NAME
fi

# Only prompt for deployment inputs if not destroying
if [ "$ACTION" != "destroy" ]; then
  if [ -z "${KNOWLEDGE_BASE_ID:-}" ]; then
    read -rp "Enter Bedrock Knowledge Base ID: " KNOWLEDGE_BASE_ID
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
    --source-version "full-cdk" \
    --output json \
    --no-cli-pager >/dev/null
  echo "✓ CodeBuild project created"
  fi
fi

# Start the build
echo "Starting build..."
BUILD_ID=$(aws codebuild start-build \
  --project-name "$PROJECT_NAME" \
  --source-version "full-cdk" \
  --query 'build.id' \
  --output text)

echo "✓ Build started: $BUILD_ID"
echo "Streaming logs..."
echo "==========================================="

# Stream logs in real-time
aws logs tail "/aws/codebuild/$PROJECT_NAME" \
  --follow \
  --format short