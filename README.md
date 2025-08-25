# iECHO RAG Chatbot

An intelligent multi-domain chatbot built with AWS Bedrock, Strands framework, and deployed on EKS Fargate.

## Architecture

- **Orchestration Agent**: Routes queries to specialized domain agents
- **Specialized Agents**: TB and Agriculture domain experts
- **Knowledge Base**: AWS Bedrock Knowledge Base with vector search
- **Streaming**: Real-time response streaming using Strands framework
- **Infrastructure**: EKS Fargate with API Gateway, ALB, DynamoDB, CloudWatch

## Prerequisites

- AWS CLI configured with appropriate permissions
- Node.js 18+ and npm
- Docker
- CDK CLI (`npm install -g aws-cdk`)
- Knowledge Base created manually in AWS Bedrock

## Required AWS Permissions

Your AWS user/role needs permissions for:
- EKS, Fargate, VPC, ALB
- API Gateway, DynamoDB, CloudWatch Logs
- Bedrock (InvokeModel, RetrieveAndGenerate)
- ECR, IAM, SSM

## Complete Deployment Guide

### Step 1: Prerequisites Setup

1. **Install Required Tools**:
   ```bash
   # Install AWS CLI
   curl "https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip" -o "awscliv2.zip"
   unzip awscliv2.zip
   sudo ./aws/install
   
   # Install Node.js 18+
   # Download from https://nodejs.org/
   
   # Install CDK CLI
   npm install -g aws-cdk
   
   # Install Docker
   # Follow instructions at https://docs.docker.com/get-docker/
   ```

2. **Configure AWS CLI**:
   ```bash
   aws configure
   # Enter your AWS Access Key ID, Secret Access Key, Region, and Output format
   ```

3. **Verify Prerequisites**:
   ```bash
   aws --version
   node --version
   npm --version
   cdk --version
   docker --version
   ```

### Step 2: Create Knowledge Base (Manual)

#### Step 1: Create S3 Bucket and Upload Documents

1. Create S3 bucket: `s3-iecho-documents`
2. Create folder structure:
   ```
   s3-iecho-documents/
   ├── uploads/
   │   ├── TB_documents.pdf
   │   ├── Agriculture_guides.pdf
   │   └── ... (raw uploaded files)
   └── processed/
       ├── TB_documents.pdf
       ├── Agriculture_guides.pdf
       └── ... (processed files for Knowledge Base)
   ```

3. **Supported File Formats**:
   - PDF files (.pdf) - copied directly to processed folder
   - Microsoft Word (.docx) - converted to PDF
   - Microsoft Excel (.xlsx) - converted to PDF  
   - Microsoft PowerPoint (.pptx) - converted to PDF

4. Upload your documents to the `uploads/` folder
5. Files are automatically processed and moved to `processed/` folder for Knowledge Base ingestion

#### Step 2: Create S3 Vector Store Bucket

1. Create S3 bucket for vector store: `s3-iecho-vector-store`
2. Enable versioning on the bucket
3. Note the bucket name for Knowledge Base configuration

#### Step 3: Create Bedrock Knowledge Base

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

### Step 3: Clone and Setup Project

```bash
# Clone the repository
git clone <your-repository-url>
cd iECHO-RAG-CHATBOT

# Navigate to backend
cd backend

# Install dependencies
npm install
```

### Step 4: Bootstrap CDK (First Time Only)

```bash
# Bootstrap CDK in your AWS account and region
cdk bootstrap
```

### Step 5: Deploy Infrastructure

```bash
# Navigate to backend
cd backend

# Install dependencies
npm install

# Bootstrap CDK (first time only)
cdk bootstrap

# Deploy with Knowledge Base ID (required)
cdk deploy -c knowledgeBaseId=YOUR_KNOWLEDGE_BASE_ID

# Deploy with office-to-PDF processor (optional)
cdk deploy -c knowledgeBaseId=YOUR_KNOWLEDGE_BASE_ID -c documentsBucketName=s3-iecho-documents

# Or add to cdk.json:
# {
#   "context": {
#     "knowledgeBaseId": "YOUR_KNOWLEDGE_BASE_ID",
#     "documentsBucketName": "s3-iecho-documents"
#   }
# }
```

**Office-to-PDF Processor** (when `documentsBucketName` is provided):
- Converts .docx, .xlsx, .pptx files to PDF when uploaded to `uploads/`
- Copies .pdf files directly to `processed/` folder (no conversion needed)
- Moves all processed files to `processed/` folder for Knowledge Base ingestion
- Deletes original files after processing

### Step 6: Get API Endpoint

After deployment, note the `ApiGatewayUrl` from CDK outputs:
```
Outputs:
AgentEksFargateStack.ApiGatewayUrl = https://xxxxxxxxxx.execute-api.us-west-2.amazonaws.com/prod/
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
# Response time: ~5.4 seconds

# Streaming chat with agent routing - Agriculture query
curl -X POST https://your-api-gateway-url/chat-stream \
  -H "Content-Type: application/json" \
  -d '{
    "query": "How can I improve irrigation efficiency in my farm?",
    "userId": "farmer-456",
    "sessionId": "session-789"
  }'
# Response time: ~6.1 seconds with real-time streaming

# Mixed domain query - Nutrition and TB
curl -X POST https://your-api-gateway-url/chat-stream \
  -H "Content-Type: application/json" \
  -d '{
    "query": "How does nutrition affect TB treatment outcomes?",
    "userId": "researcher-101",
    "sessionId": "research-session"
  }'
# Response time: ~5.4 seconds

# Test feedback
curl -X POST https://your-api-gateway-url/feedback \
  -H "Content-Type: application/json" \
  -d '{
    "userId": "test-user",
    "responseId": "unique-response-uuid",
    "rating": 5,
    "feedback": "Great response!"
  }'
```

### Step 8: Upload Documents to Knowledge Base

```bash
# Upload documents to the uploads folder
aws s3 cp your-document.pdf s3://s3-iecho-documents/uploads/
aws s3 cp your-presentation.pptx s3://s3-iecho-documents/uploads/
aws s3 cp your-spreadsheet.xlsx s3://s3-iecho-documents/uploads/

# Check processed files
aws s3 ls s3://s3-iecho-documents/processed/

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

- **GET /health**: Health check
- **POST /chat**: Fast non-streaming chat (< 5 seconds)
- **POST /chat-stream**: Streaming chat with agent routing
- **POST /feedback**: Submit user feedback
- **GET /documents**: List processed documents
- **GET /status**: Get system status

## Environment Variables

The application uses these environment variables (automatically set by CDK):

- `KNOWLEDGE_BASE_ID`: Your Bedrock Knowledge Base ID
- `AWS_REGION`: AWS region
- `AWS_ACCOUNT_ID`: AWS account ID
- `FEEDBACK_TABLE_NAME`: DynamoDB table name
- `LOG_GROUP`: CloudWatch log group

## Monitoring

- **CloudWatch Logs**: `/aws/eks/{cluster-name}/agent-service`
- **DynamoDB**: `iecho-feedback-table`
- **API Gateway**: Built-in monitoring and logging

## Local Development

```bash
cd backend/docker/app

# Install Python dependencies
pip install -r requirements.txt

# Set environment variables
export KNOWLEDGE_BASE_ID=your-kb-id
export AWS_REGION=us-west-2
export AWS_ACCOUNT_ID=your-account-id

# Run locally
python app.py
```

## Cleanup

```bash
cdk destroy
```

**Note**: If ingress deletion gets stuck, manually delete ALB from EC2 console and retry.

## Chat Endpoint Comparison

| Feature | `/chat` | `/chat-stream` |
|---------|---------|----------------|
| **Response Time** | 5.4-7.5 seconds | 3.6-6.1 seconds |
| **Response Type** | Complete JSON | Streaming NDJSON |
| **Agent Routing** | Unified multi-agent orchestration | Unified multi-agent orchestration |
| **Streaming** | No | Word-by-word real-time |
| **User Experience** | Complete response at once | Immediate feedback, progressive loading |
| **Use Case** | API integrations, mobile apps | Web apps, interactive chat |
| **Best For** | Batch processing, simple queries | Real-time chat, complex queries |
| **Concurrent Performance** | Good | Excellent (5.4s under load) |
| **Error Handling** | Fast (0.5s) | Fast (0.5s) |

## Troubleshooting

### Common Issues

1. **Knowledge Base not found**: Verify the KB ID is correct
2. **Permission denied**: Check IAM roles and policies
3. **Deployment fails**: Ensure AWS CLI is configured correctly

### Logs

Check CloudWatch logs for detailed error information:
```bash
aws logs tail /aws/eks/your-cluster-name/agent-service --follow
```

### Knowledge Base Issues

1. **Sync failed**: Check S3 permissions and document formats
2. **No results**: Verify vector index configuration and embeddings
3. **Slow responses**: Check OpenSearch Serverless performance settings

## Performance Metrics

### Response Times (Tested)
- **Fast `/chat` endpoint**:
  - TB queries: 5.4 seconds
  - Agriculture queries: 7.5 seconds
  - Error responses: 0.5 seconds

- **Streaming `/chat-stream` endpoint**:
  - Simple queries: 3.6-4.4 seconds
  - Complex queries: 4.7-6.1 seconds
  - Concurrent requests: 5.4 seconds (no degradation)
  - Word-by-word streaming with immediate start

### Agent Routing Accuracy
- **TB topics**: Tuberculosis specialist with medical citations
- **Agriculture topics**: Agriculture specialist with farming citations
- **Mixed queries**: Intelligent routing to appropriate domain expert
- **Session continuity**: Context maintained across conversations

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

## API Documentation

See [docs/API.md](docs/API.md) for detailed API specifications and examples.