# iECHO RAG Chatbot

An intelligent multi-domain chatbot built with AWS Bedrock, Strands framework, and deployed on EKS Fargate.

## Architecture

- **Multi-Agent Orchestrator**: Routes queries using natural language to specialist agents
- **Specialist Agents**: TB, Agriculture, and General health/education experts with KB search tools
- **Knowledge Base**: AWS Bedrock Knowledge Base with Nova Lite v1:0 model and vector search
- **Streaming Framework**: Real-time response streaming with reasoning suppression using Strands
- **Session Management**: In-memory conversation history with 1-hour TTL and garbage collection
- **Image Analysis**: Optional image processing via strands_tools.image_reader
- **Infrastructure**: EKS Fargate, API Gateway, ALB, DynamoDB, CloudWatch with comprehensive logging

## Prerequisites

- AWS CLI configured with appropriate permissions
- Knowledge Base created manually in AWS Bedrock
- S3 buckets for documents and vector store

**Note**: Node.js, CDK CLI, Docker, and other build tools are handled automatically by the deploy.sh script via CodeBuild

**For Manual Deployment Only**:
- Node.js 20+ and npm
- CDK CLI (`npm install -g aws-cdk`)
- Docker Desktop running

## Required AWS Permissions

Your AWS user/role needs permissions for:
- EKS, Fargate, VPC, ALB, EC2
- API Gateway, DynamoDB, CloudWatch Logs
- Bedrock (InvokeModel, RetrieveAndGenerate)
- ECR, IAM, SSM, S3
- Lambda (if using office-to-PDF processor)

## Complete Deployment Guide

### Step 1: Prerequisites Setup

1. **Install AWS CLI**:
   
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
   
   **Windows (PowerShell):**
   ```powershell
   msiexec.exe /i https://awscli.amazonaws.com/AWSCLIV2.msi
   ```

2. **Configure AWS CLI**:
   ```bash
   aws configure
   # Enter your AWS Access Key ID, Secret Access Key, Region, and Output format
   ```

3. **Verify Setup**:
   ```bash
   aws --version
   ```

4. **For Manual Deployment Only** (skip if using deploy.sh):
   
   **Install Node.js 20+:**
   
   **Linux (Ubuntu/Debian):**
   ```bash
   curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
   sudo apt-get install -y nodejs
   ```
   
   **macOS:**
   ```bash
   brew install node@20
   ```
   
   **Windows (PowerShell as Admin):**
   ```powershell
   winget install OpenJS.NodeJS
   ```
   
   **Install CDK CLI:**
   ```bash
   npm install -g aws-cdk
   ```
   
   **Install Docker:**
   
   **Linux (Ubuntu/Debian):**
   ```bash
   sudo apt-get update
   sudo apt-get install -y docker.io
   sudo systemctl start docker
   sudo systemctl enable docker
   ```
   
   **macOS:**
   ```bash
   brew install --cask docker
   ```
   
   **Windows (PowerShell as Admin):**
   ```powershell
   winget install Docker.DockerDesktop
   ```
   
   **Verify Installation:**
   ```bash
   node --version
   npm --version
   cdk --version
   docker --version
   ```

### Step 2: Create Required S3 Buckets (Manual)

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

### Step 3: Create Bedrock Knowledge Base (Manual)

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
   - **Embeddings model**: Amazon Titan Text Embeddings G1 - Text

6. **Vector Database**:
   - **Vector database**: Amazon S3
   - **S3 bucket**: `s3-iecho-vector-store` (from Step 2)
   - **S3 key prefix**: `vector-index/` (optional)
   - **Non-filterable keys**: `AMAZON_BEDROCK_TEXT,AMAZON_BEDROCK_METADATA`

7. **Review and Create**
8. **Sync Data Source** after creation (this may take several minutes)
9. **Note down the Knowledge Base ID** from the details page

### Step 4: Clone and Setup Project

```bash
# Clone the repository
git clone https://github.com/ASUCICREPO/IECHO-RAG-CHATBOT.git
cd IECHO-RAG-CHATBOT

# Navigate to backend
cd backend

# Install dependencies
npm install
```

### Step 5: Deploy Infrastructure

```bash
# Make deploy script executable
chmod +x deploy.sh
```

```bash
# Run deployment script (will prompt for required inputs)
./deploy.sh
```

**Deploy.sh Script Flow (Deployment Mode)**:
1. **Prompts for inputs**:
   - Action: Select `deploy`
   - GitHub repository URL (e.g., https://github.com/ASUCICREPO/IECHO-RAG-CHATBOT)
   - CodeBuild project name (alphanumeric, 2-255 chars)
   - Bedrock Knowledge Base ID (10 uppercase alphanumeric)
   - S3 documents bucket name (optional for office-to-PDF processor)
   - GitHub personal access token (needs repo permissions)

2. **Sets up AWS infrastructure**:
   - Creates IAM service role `{project-name}-service-role` with AdministratorAccess
   - Stores GitHub token in AWS Secrets Manager as `github-access-token`
   - Imports GitHub OAuth credentials for CodeBuild source access

3. **Creates/updates CodeBuild project**:
   - Uses `aws/codebuild/amazonlinux-x86_64-standard:5.0` image
   - Configures environment variables: KNOWLEDGE_BASE_ID, GITHUB_OWNER, GITHUB_REPO, DOCUMENTS_BUCKET, ACTION
   - Sets GitHub repository as source with `full-cdk` branch
   - Links to IAM service role for permissions

4. **Executes deployment via CodeBuild**:
   - Starts build with `full-cdk` branch
   - CodeBuild runs buildspec.yml which:
     - Installs Node.js 20, CDK CLI, npm dependencies
     - Builds TypeScript sources
     - Bootstraps CDK with context parameters
     - Deploys CDK stack with all infrastructure
   - Streams real-time logs from `/aws/codebuild/{project-name}`
   - Monitors build status until completion
   - Displays API Gateway URL and Amplify frontend URL on success

**Alternative manual deployment**:
```bash
# Bootstrap CDK (first time only)
cdk bootstrap

# Store GitHub token in Secrets Manager first
aws secretsmanager create-secret \
  --name github-access-token \
  --secret-string "YOUR_GITHUB_TOKEN" \
  --description "GitHub access token for Amplify"

# Deploy manually with all required context
cdk deploy \
  -c knowledgeBaseId=YOUR_KNOWLEDGE_BASE_ID \
  -c documentsBucketName=YOUR_DOCUMENTS_BUCKET \
  -c githubOwner=YOUR_GITHUB_OWNER \
  -c githubRepo=YOUR_GITHUB_REPO
```

**Infrastructure Components Deployed**:
- **EKS Fargate Cluster**: Kubernetes v1.32 with full logging enabled
- **VPC**: 2 AZs, 1 NAT Gateway, public/private subnets
- **Docker Application**: Python 3.12 FastAPI app with 2 workers, non-root user
- **ALB Controller**: AWS Load Balancer Controller v1.8.0 via Helm
- **API Gateway**: REST API with CORS, proxies to ALB
- **DynamoDB**: Pay-per-request feedback table with TTL
- **CloudWatch**: Application logs with infinite retention
- **Amplify**: Frontend deployment with GitHub integration
- **Office-to-PDF Lambda** (optional): Node.js 18 with LibreOffice layer for document conversion

### Step 6: Get API Endpoint

After deployment, note the `ExportApiGatewayUrl` from CDK outputs:
```
Outputs:
AgentEksFargateStack.ExportApiGatewayUrl = https://xxxxxxxxxx.execute-api.us-west-2.amazonaws.com/prod/
```

### Step 7: Test Deployment

```bash
# Health check
curl https://your-api-gateway-url/health

# Fast chat (non-streaming) - TB query
curl -X POST https://your-api-gateway-url/chat \
  -H "Content-Type: application/json" \
  -d '{
    "query": "What are the main symptoms of tuberculosis?",
    "userId": "test-user-123",
    "sessionId": "session-456"
  }'

# Streaming chat with agent routing - Agriculture query
curl -X POST https://your-api-gateway-url/chat-stream \
  -H "Content-Type: application/json" \
  -d '{
    "query": "How can I improve irrigation efficiency in my farm?",
    "userId": "farmer-456",
    "sessionId": "session-789"
  }'

# Mixed domain query - Nutrition and TB
curl -X POST https://your-api-gateway-url/chat-stream \
  -H "Content-Type: application/json" \
  -d '{
    "query": "How does nutrition affect TB treatment outcomes?",
    "userId": "researcher-101",
    "sessionId": "research-session"
  }'

# Test feedback (use responseId from chat response)
curl -X POST https://your-api-gateway-url/feedback \
  -H "Content-Type: application/json" \
  -d '{
    "userId": "test-user",
    "responseId": "response-id-from-chat-response",
    "rating": 5,
    "feedback": "Great response!"
  }'
```

### Step 8: Upload Documents to Knowledge Base

```bash
# Upload documents to the uploads folder
aws s3 cp your-document.pdf s3://YOUR_DOCUMENTS_BUCKET/uploads/
aws s3 cp your-presentation.pptx s3://YOUR_DOCUMENTS_BUCKET/uploads/
aws s3 cp your-spreadsheet.xlsx s3://YOUR_DOCUMENTS_BUCKET/uploads/

# Check processed files (if office-to-PDF processor enabled)
aws s3 ls s3://YOUR_DOCUMENTS_BUCKET/processed/

# Sync Knowledge Base data source
# Go to AWS Bedrock Console → Knowledge Bases → Your KB → Data Sources → Sync
```

### Step 9: Verify Complete Setup

```bash
# Test the complete workflow
curl -X POST https://your-api-gateway-url/chat-stream \
  -H "Content-Type: application/json" \
  -d '{
    "query": "What are the main symptoms of tuberculosis?",
    "userId": "test-user-123",
    "sessionId": "session-456"
  }'
```

## API Endpoints

- **GET /health**: Health check with timestamp
- **POST /chat**: Non-streaming chat with unified multi-agent orchestration (150 token limit)
- **POST /chat-stream**: Streaming chat with real-time agent routing (150 token limit, 25s timeout)
- **POST /feedback**: Submit user feedback (1-5 rating scale) to DynamoDB
- **GET /documents**: List processed documents from Knowledge Base S3 bucket
- **GET /document-url/{path}**: Generate presigned URLs for document access
- **GET /status**: System status with configuration details

## Environment Variables

The application uses these environment variables (automatically set by CDK):

- `KNOWLEDGE_BASE_ID`: Your Bedrock Knowledge Base ID
- `AWS_REGION`: AWS region (default: us-west-2)
- `AWS_ACCOUNT_ID`: AWS account ID
- `FEEDBACK_TABLE_NAME`: DynamoDB table name (`iecho-feedback-table-{stack-name}`)
- `LOG_GROUP`: CloudWatch log group (`/aws/eks/{cluster-name}/agent-service`)
- `PORT`: Application port (default: 8000)

## Monitoring

- **CloudWatch Logs**: `/aws/eks/{cluster-name}/agent-service` (infinite retention)
  - Chat completion logs with user ID, session ID, selected agent, query, response, citations
  - Error logs with structured JSON details (error type, endpoint, user context)
  - Daily log streams: `agent-service-{YYYY-MM-DD}`
- **EKS Cluster Logs**: `/aws/eks/{cluster-name}/cluster` (default retention - never expire)
- **Fargate Logs**: `/aws/eks/{cluster-name}/fargate` (default retention - never expire)
- **Lambda Logs** (optional): `/aws/lambda/office-to-pdf-{stack-name}` (2 weeks retention)
- **CodeBuild Logs**: `/aws/codebuild/{project-name}` (default retention - never expire)
- **In-Memory Sessions**: Conversation history with 1-hour TTL and automatic garbage collection
- **DynamoDB**: `iecho-feedback-table-{stack-name}` with TTL
- **API Gateway**: Built-in monitoring and logging



## Cleanup

```bash
# Use the deploy script in destroy mode (recommended)
./deploy.sh
```

**Deploy.sh Script Flow (Destroy Mode)**:
1. **Prompts for inputs**:
   - Action: Select `destroy`
   - CodeBuild project name (existing project from deployment)

2. **Skips GitHub setup**:
   - No GitHub URL, token, or OAuth setup required
   - Uses existing CodeBuild project configuration

3. **Updates CodeBuild project**:
   - Sets ACTION environment variable to `destroy`
   - Keeps existing project configuration intact

4. **Executes destruction via CodeBuild**:
   - Starts CodeBuild with destroy action
   - CodeBuild runs buildspec.yml which:
     - Skips build and bootstrap phases
     - Runs `cdk destroy --force`
     - If CDK destroy fails, cleans up k8s security groups first
     - Retries CDK destroy after cleanup
   - Streams real-time logs from `/aws/codebuild/{project-name}`
   - Monitors build status until infrastructure is destroyed
   - Displays "DESTROY COMPLETE" message on success

**Alternative manual cleanup**:
```bash
# Manual cleanup with security group handling
cdk destroy --force || {
  echo "CDK destroy failed, cleaning up k8s security groups...";
  aws ec2 describe-security-groups --filters "Name=group-name,Values=k8s-*" --query 'SecurityGroups[].GroupId' --output text 2>/dev/null | xargs -r -n1 aws ec2 delete-security-group --group-id 2>/dev/null || true;
  sleep 10;
  echo "Retrying CDK destroy...";
  cdk destroy --force;
}
```

## Troubleshooting

### Common Issues

1. **Knowledge Base not found**: Verify the KB ID provided to deploy.sh script
2. **Permission denied**: Check IAM roles and policies
3. **Docker not running**: Ensure Docker Desktop is running before deployment
4. **CDK bootstrap required**: Run `cdk bootstrap` in your region first
5. **Deploy script fails**: Check script permissions with `chmod +x deploy.sh`

### Logs

Check CloudWatch logs for detailed error information:
```bash
# Application logs
aws logs tail /aws/eks/your-cluster-name/agent-service --follow

# EKS cluster logs
aws logs tail /aws/eks/your-cluster-name/cluster --follow
```

### Knowledge Base Issues

1. **Sync failed**: Check S3 permissions and document formats
2. **No results**: Verify vector index configuration and embeddings
3. **Slow responses**: Check OpenSearch Serverless performance settings
4. **Office files not processed**: Ensure documents bucket name was provided to deploy.sh script

### Deployment Issues

1. **ALB stuck on delete**: Use `./deploy.sh` script in destroy mode or manually delete ALB
2. **ECR push fails**: Check Docker is running and AWS credentials
3. **EKS access denied**: Verify kubectl is configured with cluster access

## Features

- **Unified Agent Architecture**: Both endpoints use identical multi-agent orchestration
- **Multi-domain Expertise**: TB and Agriculture specialists with domain-specific knowledge
- **Real-time Streaming**: Word-by-word progressive response loading
- **Citation Support**: Responses include source citations from knowledge base
- **Feedback System**: Users can rate and comment on responses
- **Session Management**: Conversation context maintained across interactions
- **Health Monitoring**: Built-in health checks and monitoring
- **Auto-scaling**: EKS Fargate automatically scales based on demand
- **API Gateway Compatible**: Both endpoints work through API Gateway
- **Concurrent Processing**: Handles multiple simultaneous requests efficiently