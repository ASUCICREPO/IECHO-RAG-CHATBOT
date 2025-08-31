#!/usr/bin/env bash
set -euo pipefail

# Prompt for action first
if [ -z "${ACTION:-}" ]; then
  read -rp "Deploy or destroy? [deploy/destroy]: " ACTION
  ACTION=$(printf '%s' "$ACTION" | tr '[:upper:]' '[:lower:]')
fi

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
  exit 0
fi

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

if [ -z "${GITHUB_TOKEN:-}" ]; then
  read -rp "Enter GitHub personal access token (repo permissions): " GITHUB_TOKEN
fi

# Skip inputs for destroy
if [ "$ACTION" = "destroy" ]; then
  echo "Destroy mode - skipping deployment-specific inputs"
  KNOWLEDGE_BASE_ID=""
  DOCUMENTS_BUCKET=""
  GITHUB_OWNER=""
  GITHUB_REPO=""
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

# Create CodeBuild project
echo "Creating CodeBuild project: $PROJECT_NAME"

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

aws codebuild create-project \
  --name "$PROJECT_NAME" \
  --source "$SOURCE" \
  --artifacts "$ARTIFACTS" \
  --environment "$ENVIRONMENT" \
  --service-role "$ROLE_ARN" \
  --source-version "full-cdk" \
  --output json \
  --no-cli-pager

echo "✓ CodeBuild project created"

# Start the build
echo "Starting build..."
aws codebuild start-build \
  --project-name "$PROJECT_NAME" \
  --source-version "full-cdk" \
  --no-cli-pager \
  --output json

echo "✓ Build started successfully"
echo "Check AWS CodeBuild console for progress"