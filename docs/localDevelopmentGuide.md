# Local Development Setup Guide

This guide shows how to run the iECHO RAG Chatbot backend and frontend locally for development.

## Prerequisites

### Required Software
- **Node.js 18.x or later** - [Download here](https://nodejs.org/)
- **Python 3.11+** - [Download here](https://www.python.org/downloads/)
- **AWS CLI v2** - [Download here](https://aws.amazon.com/cli/)

### Required AWS Resources (Deploy First)
Before running locally, you need these cloud resources deployed:
- **AWS Bedrock Knowledge Base** in us-west-2 region
- **DynamoDB table** for feedback storage
- **S3 bucket** with documents for the Knowledge Base
- **AWS credentials** configured locally

## Step 1: Configure AWS CLI

Before creating any AWS resources, you need to configure your AWS credentials:

```bash
aws configure
```

Enter your:
- **AWS Access Key ID**: Your access key
- **AWS Secret Access Key**: Your secret key  
- **Default region name**: `us-west-2`
- **Default output format**: `json`

**Note**: This only needs to be done once per machine. Your credentials are stored in `~/.aws/credentials` and `~/.aws/config`.

## Step 2: Verify Prerequisites

Before creating AWS resources, verify you have access to required Bedrock models:

### 2.1 Check Bedrock Model Access

Verify you have access to required Bedrock models:

```bash
# Check Nova Lite model access
aws bedrock list-foundation-models --region us-west-2 --query 'modelSummaries[?contains(modelId, `amazon.nova-lite-v1:0`)]'

# Check Titan Embeddings model access  
aws bedrock list-foundation-models --region us-west-2 --query 'modelSummaries[?contains(modelId, `amazon.titan-embed-g1-text-02`)]'
```

### 2.2 Request Model Access (if needed)

If models are not available, request access in AWS Console:

1. Go to **Amazon Bedrock** → **Model access**
2. Request access for:
   - **Amazon Nova Lite** (`amazon.nova-lite-v1:0`) - for chat responses
   - **Amazon Titan Embeddings G1 - Text** (`amazon.titan-embed-g1-text-02`) - for knowledge base

**Note**: Model access requests may take a few minutes to be approved.

### 2.3 Verify Region Configuration

Ensure you're working in the correct region:

```bash
# Check current region
aws configure get region

# Set region if needed
aws configure set region us-west-2
```

**Important**: This solution must be deployed in **us-west-2** region.

## Step 3: Create Required AWS Resources

Before running locally, ensure you have these AWS resources deployed:

### 3.1 Create Bedrock Knowledge Base

#### Step 1: Create S3 Buckets

#### Documents Bucket
1. Search S3 in search bar in console.
2. Click on `"General purpose buckets"` in left pane
3. Click on `"Create bucket"` on main window
4. Keep the bucket type `"General purpose"`
5. Give the bucket name `"s3-iecho-documents"`
6. Under Bucket Versioning, select `"Enable"`
7. Keep other configurations as it is
8. Click on `"Create bucket"`, now bucket will be created, should take less then a minute
9. Once done, search the bucket by name `"s3-iecho-documents"`
10. Click on bucket name `"s3-iecho-documents"`, this will display the contents of bucket
11. Click on `"Create folder"`
12. Give folder name `"uploads"` and click on `"Create folder"`
13. Again, click on `"Create folder"`
14. Give folder name `"processed"` and click on `"Create folder"`
15. This will create the following folder structure:
   ```
   s3-iecho-documents/
   ├── uploads/     
   └── processed/   
   ```
16. Click on folder name `"processed/"` (only for local dev upload directly to processed folder)
17. Click on `"Upload"` button
18. Click on `"Add files"`
19. Select all the files that you want to upload
20. **Supported formats**: PDF, DOCX, XLSX, PPTX
21. Click on `"Upload"`, wait for files to be uploaded
22. Once uploaded, click on `"close"`
23. Now, your TB and Agriculture documents are uploaded in `"processed/"` folder
    
#### Vector Store Bucket
1. Select `"Vector buckets"` in left pane
2. Click on `"Create vector bucket"` button
3. Give vector bucket name: `"s3-iecho-vector-store"`
4. Click on `"Create vector bucket"` button
5. This will create the vector bucket
6. Search the vector bucket by name `"s3-iecho-vector-store"`
7. Click on the bucket name `"s3-iecho-vector-store"`
8. This will open the contents of the vector bucket
9. Click on `"Create vector index"`
10. Under the properties set the vector index name as `"s3-iecho-vector-index"`
11. Set dimensions to `"1536"`
12. Click on `"Additional settings"`
13. Under non-filterable metadata, add following keys:
   - `AMAZON_BEDROCK_TEXT`
   - `AMAZON_BEDROCK_METADATA`
14. Click on `"Create vector index"`
15. This will create a vector index inside vector bucket

Note both bucket names (vector bucket and general purpose bucket) for next steps

#### Step 2: Create Bedrock Knowledge Base

1. Now, search `"Amazon Bedrock"` in search bar in console
2. Click on `"Amazon Bedrock"`
3. In left pane, under the `"Build"` section, select `"Knowledge Bases"`
4. Click `"Create"`
5. Select `"Knowledge Base with vector store"` under `"Unstructred data"`
6. Give knowledge base name: `"iECHO-RAG-Knowledge-Base"`
7. Choose data source type: `"Amazon S3"`
8. Keep other configurations as it is
9. Click `"Next"`
10. Select the following for Data Source Configuration:
   - **Data source name**: `iecho-documents`
   - **S3 URI**: `s3://s3-iecho-documents/processed/`
   - **Parsing strategy**: `Amazon Bedrock Data Automation as parser`
   - **Chunking strategy**: `Hierarchial chunking`
11. Keep other configurations as it is
12. Click `"Next"`
13. Select embeddings model: `"Amazon Titan Embeddings G1"`
14. Under vector store, select `"Use an existing vector store"`
15. Select vector store type: `"S3 Vectors - Preview"`
16. Click on `"Browse S3"`
17. Search vector bucket by name: `"s3-iecho-vector-store"`
18. Select the bucket
19. For s3 vector index ARN, select `"s3-iecho-vector-index"`, it will populate the ARN automatically from the name
20. Select multimodal storage destination as `"s3://s3-iecho-documents"`
21. Click `"Next"`
22. Review the datails
23. Click on `"Create Knowledge Base"`, this will create the knowledge base and should take less than 2 minutes
24. **Note down the Knowledge Base ID** from the `"Knowledge Base overview"` section (format: XXXXXXXXXX)

### 3.2 Create DynamoDB Table

Create a DynamoDB table for feedback storage:

```bash
# Create feedback table
aws dynamodb create-table \
    --table-name iecho-feedback-table-local-dev \
    --attribute-definitions \
        AttributeName=feedbackId,AttributeType=S \
    --key-schema \
        AttributeName=feedbackId,KeyType=HASH \
    --billing-mode PAY_PER_REQUEST \
    --region us-west-2
```

**Table Configuration**:
- **Table Name**: `iecho-feedback-table-local-dev`
- **Partition Key**: `feedbackId` (String)
- **Billing Mode**: Pay per request
- **TTL**: Optional (can be added later)

### 3.3 Create CloudWatch Log Group

Create a CloudWatch log group for application logging:

```bash
# Create log group
aws logs create-log-group \
    --log-group-name /aws/eks/local-dev/agent-service \
    --region us-west-2

# Set retention policy (optional)
aws logs put-retention-policy \
    --log-group-name /aws/eks/local-dev/agent-service \
    --retention-in-days 14 \
    --region us-west-2
```

**Log Group Configuration**:
- **Log Group Name**: `/aws/eks/local-dev/agent-service`
- **Retention**: 14 days (adjust as needed)
- **Region**: `us-west-2`

### 3.4 Verify Resource Creation

Verify all resources are created successfully:

```bash
# Check Knowledge Base
aws bedrock-agent list-knowledge-bases --region us-west-2

# Check DynamoDB table
aws dynamodb describe-table --table-name iecho-feedback-table-local-dev --region us-west-2

# Check CloudWatch log group
aws logs describe-log-groups --log-group-name-prefix /aws/eks/local-dev --region us-west-2
```

### 3.5 Get Resource Identifiers

After creating the resources, note down these identifiers for your environment variables:

```bash
# Get Knowledge Base ID
aws bedrock-agent list-knowledge-bases --region us-west-2 --query 'knowledgeBaseSummaries[?name==`iECHO-RAG-Knowledge-Base`].knowledgeBaseId' --output text

# Get DynamoDB table name
echo "iecho-feedback-table-local-dev"

# Get CloudWatch log group name
echo "/aws/eks/local-dev/agent-service"
```

## Step 4: Clone Repository

```bash
git clone https://github.com/ASUCICREPO/IECHO-RAG-CHATBOT.git
cd IECHO-RAG-CHATBOT
```

## Step 5: Backend Setup (FastAPI)

### 5.1 Install Python Dependencies

```bash
cd backend
python3 -m venv venv

# Activate virtual environment
# On macOS/Linux:
source venv/bin/activate
# On Windows:
venv\Scripts\activate

# Install dependencies
pip install -r docker/requirements.txt
```

### 5.2 Configure Environment Variables

Set environment variables in your terminal (no .env file needed):

```bash
# Set environment variables for local development
export AWS_REGION=us-west-2
export AWS_ACCOUNT_ID=your-aws-account-id
export KNOWLEDGE_BASE_ID=your-knowledge-base-id
export FEEDBACK_TABLE_NAME=iecho-feedback-table-local-dev
export LOG_GROUP=/aws/eks/local-dev/agent-service
```

**Important**: Replace the placeholder values with your actual AWS resources.

**Note**: These environment variables are only for your current terminal session. If you open a new terminal, you'll need to set them again.

### 5.3 Start Backend Server

```bash
# From backend/ directory with venv activated
cd docker/app
python app.py
```

The backend API will be available at `http://localhost:8000`

**Test the backend:**
```bash
# Health check
curl http://localhost:8000/health

# Status check (shows if Knowledge Base is configured)
curl http://localhost:8000/status
```

## Step 6: Frontend Setup (Next.js)

### 6.1 Install Dependencies

```bash
cd frontend
npm install
```

### 6.2 Configure Environment Variables

Create a `.env.local` file in the `frontend/` directory:

```bash
cat > .env.local << 'EOF'
# Backend API URL
NEXT_PUBLIC_API_BASE_URL=http://localhost:8000
EOF
```

### 6.3 Start Frontend Server

```bash
# From frontend/ directory
npm run dev
```

The frontend will be available at `http://localhost:3000`

## Step 7: Testing the Application

### 7.1 Test Backend API

```bash
# Test chat endpoint
curl -X POST http://localhost:8000/chat \
  -H "Content-Type: application/json" \
  -d '{"query": "What is tuberculosis?", "userId": "test-user"}'

# Test streaming endpoint
curl -X POST http://localhost:8000/chat-stream \
  -H "Content-Type: application/json" \
  -d '{"query": "Tell me about agriculture", "userId": "test-user"}'
```

### 7.2 Test Frontend
- Open http://localhost:3000 in your browser
- Try asking questions about TB or agriculture
- Check that responses include citations

## Step 8: Development Workflow

### 8.1 Backend Changes
- Edit `backend/docker/app/app.py`
- Restart the Python server to see changes

### 8.2 Frontend Changes
- Edit files in `frontend/components/` or `frontend/app/`
- The Next.js dev server auto-reloads on changes

### 8.3 Environment Changes
- Update environment variables in your terminal
- Update `.env.local` file for frontend
- Restart both servers to apply changes

## Common Issues

**Backend won't start:**
- Check if port 8000 is available
- Verify Python virtual environment is activated
- Check environment variables are exported in terminal

**Frontend won't start:**
- Check if port 3000 is available
- Verify Node.js dependencies are installed
- Check environment variables in `.env.local`

**API calls fail:**
- Verify backend is running on port 8000
- Check AWS credentials are configured
- Verify Knowledge Base ID is exported in terminal

**Knowledge Base errors:**
- Ensure Knowledge Base exists in us-west-2
- Check documents are uploaded to S3
- Verify IAM permissions for Bedrock
- Check that `KNOWLEDGE_BASE_ID` is exported in terminal

## Next Steps

- Read the [API Documentation](./APIdoc.md) for detailed endpoint information
- Check the [Architecture Guide](./architectureDeepDive.md) for system design
- Review the [User Guide](./userGuide.md) for application features
- Follow the [Deployment Guide](./deploymentGuide.md) for production deployment
