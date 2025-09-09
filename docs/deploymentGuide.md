# Deployment Guide

## Prerequisites

- AWS CLI installed and configured
- Knowledge Base created manually in AWS Bedrock
- S3 buckets for documents and vector store

**Note**: Node.js, CDK CLI, Docker, and other build tools are handled automatically by the deploy.sh script via CodeBuild

**Time Requirements**:
- **Deployment**: Up to 1 hour for complete infrastructure setup
- **Cleanup**: Up to 1 hour 30 minutes for complete resource removal

## Required AWS Permissions

### For AWS CLI User (aws configure)
Your AWS IAM user needs these specific permissions to run the deployment:

**IAM Permissions** (for creating CodeBuild service role):
```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "iam:CreateRole",
        "iam:AttachRolePolicy",
        "iam:GetRole",
        "iam:PassRole"
      ],
      "Resource": "*"
    }
  ]
}
```

**Secrets Manager** (for GitHub token storage):
```json
{
  "Effect": "Allow",
  "Action": [
    "secretsmanager:CreateSecret",
    "secretsmanager:UpdateSecret",
    "secretsmanager:GetSecretValue"
  ],
  "Resource": "*"
}
```

**CodeBuild** (for deployment automation):
```json
{
  "Effect": "Allow",
  "Action": [
    "codebuild:CreateProject",
    "codebuild:UpdateProject",
    "codebuild:StartBuild",
    "codebuild:BatchGetBuilds",
    "codebuild:ImportSourceCredentials"
  ],
  "Resource": "*"
}
```

**CloudWatch Logs** (for monitoring deployment):
```json
{
  "Effect": "Allow",
  "Action": [
    "logs:CreateLogGroup",
    "logs:CreateLogStream",
    "logs:GetLogEvents",
    "logs:FilterLogEvents"
  ],
  "Resource": "*"
}
```

**Simplified Option**: Attach the `PowerUserAccess` managed policy to your IAM user, which provides all necessary permissions except IAM user/group management.

## Step-by-Step Deployment

### Step 1: Configure AWS CLI

1. **Install AWS CLI** (if not already installed):
   
   **Linux:**
   ```bash
   curl "https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip" -o "awscliv2.zip"
   unzip awscliv2.zip
   sudo ./aws/install
   ```
   
   **macOS:**
   ```bash
   curl "https://awscli.amazonaws.com/AWSCLIV2.pkg" -o "AWSCLIV2.pkg"
   sudo installer -pkg AWSCLIV2.pkg -target /
   ```
   
   **Windows:**
   Download and install from: https://awscli.amazonaws.com/AWSCLIV2.msi

2. **Configure AWS CLI**:
   ```bash
   aws configure
   ```
   
   You'll be prompted for:
   - **AWS Access Key ID**: Your IAM user's access key
   - **AWS Secret Access Key**: Your IAM user's secret key
   - **Default region name**: e.g., `us-west-2`
   - **Default output format**: `json` (recommended)

3. **Verify Configuration**:
   ```bash
   aws sts get-caller-identity
   ```
   
   This should return your user ARN and account ID.

### Step 2: Create Required S3 Buckets

#### Documents Bucket
1. Create S3 bucket: `s3-iecho-documents` (choose unique name)
2. Create folder structure:
   ```
   s3-iecho-documents/
   ├── uploads/     # Raw uploaded files
   └── processed/   # Files for Knowledge Base ingestion
   ```
3. Upload your TB and Agriculture documents to `uploads/` folder
4. **Supported formats**: PDF, DOCX, XLSX, PPTX (auto-converted to PDF)

#### Vector Store Bucket
1. Create S3 bucket: `s3-iecho-vector-store` (choose unique name)
2. Enable versioning on the bucket
3. Note both bucket names for next steps

### Step 3: Create Bedrock Knowledge Base

1. Go to **AWS Bedrock Console** → **Knowledge Bases**
2. Click **Create Knowledge Base**
3. **Knowledge Base Details**:
   - **Name**: `iECHO-RAG-Knowledge-Base`
   - **Description**: Multi-domain RAG chatbot for TB and Agriculture
   - **IAM Role**: Create and use a new service role

4. **Data Source Configuration**:
   - **Data source name**: `iecho-documents`
   - **S3 URI**: `s3://s3-iecho-documents/processed/`
   - **Chunking strategy**: Hierarchical chunking

5. **Embeddings Model**:
   - **Embeddings model**: Amazon Titan Text Embeddings G1 - Multimodal

6. **Vector Database**:
   - **Vector database**: Amazon S3
   - **S3 bucket**: `s3-iecho-vector-store` (from Step 2)
   - **S3 key prefix**: `vector-index/` (optional)

7. **Review and Create**
8. **Sync Data Source** after creation (this may take several minutes)
9. **Note down the Knowledge Base ID** from the details page

### Step 4: Clone and Setup Project

```bash
# Clone the repository
git clone https://github.com/ASUCICREPO/IECHO-RAG-CHATBOT
cd iECHO-RAG-CHATBOT
```

### Step 5: Deploy Infrastructure

⏱️ **Expected Time**: Up to 1 hour for complete deployment

```bash
# Make deploy script executable
chmod +x deploy.sh

# Run deployment script (will prompt for required inputs)
./deploy.sh
```

**Deploy.sh Script Inputs**:
- Action: Select `deploy`
- GitHub repository URL
- CodeBuild project name (alphanumeric, 2-255 chars)
- Bedrock Knowledge Base ID (10 uppercase alphanumeric)
- S3 documents bucket name (optional for office-to-PDF processor)
- GitHub personal access token (needs repo permissions)

### Step 6: Monitor Deployment

The script will:
1. Create IAM service role with AdministratorAccess for CodeBuild
2. Store GitHub token in AWS Secrets Manager
3. Create/update CodeBuild project
4. Execute deployment via CodeBuild
5. Stream real-time logs from CloudWatch
6. Display API Gateway and Amplify URLs on success

**Deployment Progress**:
- **Initial Setup**: 2-3 minutes (IAM roles, CodeBuild project)
- **Infrastructure Deployment**: 30-45 minutes (EKS cluster, VPC, ALB)
- **Application Deployment**: 10-15 minutes (Docker build, Kubernetes deployment)
- **Frontend Deployment**: 5-10 minutes (Amplify build and deployment)

### Step 7: Test Deployment

```bash
# Health check
curl https://your-api-gateway-url/health

# Test chat endpoint
curl -X POST https://your-api-gateway-url/chat \
  -H "Content-Type: application/json" \
  -d '{
    "query": "What are the main symptoms of tuberculosis?",
    "userId": "test-user-123",
    "sessionId": "session-456"
  }'

# Test streaming endpoint
curl -X POST https://your-api-gateway-url/chat-stream \
  -H "Content-Type: application/json" \
  -d '{
    "query": "How can I improve soil fertility?",
    "userId": "farmer-456",
    "sessionId": "session-789"
  }'
```

## Infrastructure Components Deployed

- **EKS Fargate Cluster**: Kubernetes v1.32 with full logging
- **VPC**: 2 AZs, 1 NAT Gateway, public/private subnets
- **Docker Application**: Python 3.12 FastAPI app with 2 replicas
- **ALB Controller**: AWS Load Balancer Controller v1.8.0 via Helm
- **API Gateway**: REST API with CORS, proxies to ALB
- **DynamoDB**: Pay-per-request feedback table with TTL
- **CloudWatch**: Application logs with infinite retention
- **Amplify**: Frontend deployment with GitHub integration
- **Office-to-PDF Lambda** (optional): Document conversion service

## Cleanup

⏱️ **Expected Time**: Up to 1 hour 30 minutes for complete cleanup

```bash
# Use the deploy script in destroy mode
./deploy.sh
# Select "destroy" action and provide CodeBuild project name
```

**Cleanup Progress**:
- **Application Removal**: 5-10 minutes (Kubernetes resources, ALB)
- **EKS Cluster Deletion**: 45-60 minutes (cluster, node groups, networking)
- **Infrastructure Cleanup**: 15-20 minutes (VPC, security groups, remaining resources)

**Note**: The cleanup process includes automatic handling of Kubernetes security groups that may prevent CDK destruction. The script will retry if initial cleanup fails.

## Troubleshooting

### Common Issues

1. **AWS CLI not configured**: Run `aws configure` with valid credentials
2. **Knowledge Base not found**: Verify the KB ID provided to deploy.sh script
3. **Permission denied**: Check IAM user permissions above
4. **Deploy script fails**: Check script permissions with `chmod +x deploy.sh`
5. **CodeBuild role creation fails**: Ensure your IAM user has `iam:CreateRole` permission
6. **Deployment timeout**: EKS cluster creation can take 30-45 minutes - this is normal
7. **Cleanup stuck**: Security groups may prevent deletion - the script handles this automatically

### Logs

Check CloudWatch logs for detailed error information:
```bash
# Application logs
aws logs tail /aws/eks/your-cluster-name/agent-service --follow

# EKS cluster logs
aws logs tail /aws/eks/your-cluster-name/cluster --follow

# CodeBuild logs (during deployment)
aws logs tail /aws/codebuild/your-project-name --follow
```
