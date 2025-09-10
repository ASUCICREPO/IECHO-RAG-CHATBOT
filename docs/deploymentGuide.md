# Deployment Guide

## Prerequisites

- AWS CLI access (local installation with `aws configure` OR AWS CloudShell)
- Knowledge Base created manually in AWS Bedrock (see steps below)
- S3 bucket for documents (see steps below)

**Note**: Node.js, CDK CLI, Docker, and other build tools are handled automatically by the deploy.sh script via CodeBuild

**Time Requirements**:
- **Prerequisites Setup**: 30 minutes (Knowledge Base creation and data sync)
- **Deployment**: Up to 1 hour for complete infrastructure setup
- **Cleanup**: Up to 1 hour 30 minutes for complete resource removal

## Step-by-Step Prerequisites Setup

### Step 1: Create S3 Buckets

#### Documents Bucket
1. Create S3 bucket: `s3-iecho-documents`
2. Create folder structure:
   ```
   s3-iecho-documents/
   ├── uploads/     # Raw uploaded files
   └── processed/   # Files for Knowledge Base ingestion
   ```
3. Upload your TB and Agriculture documents to `processed/` folder
4. **Supported formats**: PDF, DOCX, TXT, MD (Knowledge Base compatible formats)

#### Vector Store Bucket
1. Create S3 bucket: `s3-iecho-vector-store`
2. Enable versioning on the bucket
3. Note both bucket names for next steps

### Step 2: Create Bedrock Knowledge Base

1. Go to **AWS Bedrock Console** → **Knowledge Bases**
2. Click **Create Knowledge Base**

3. **Knowledge Base Details**:
   - **Name**: `iECHO-RAG-Knowledge-Base`
   - **Description**: Multi-domain RAG chatbot for TB and Agriculture
   - **IAM Role**: Create and use a new service role

4. **Data Source Configuration**:
   - **Data source name**: `iecho-documents`
   - **S3 URI**: `s3://s3-iecho-documents/processed/`
   - **Chunking strategy**: Hierarchial chunking
   - **Metadata**: Optional

5. **Embeddings Model**:
   - **Embeddings model**: Amazon Titan Text Embeddings G1 - Text
   - **Dimensions**: 1536 (default)

6. **Vector Database**:
   - **Vector database**: Amazon S3 vector store
   - **Amazon S3 vector store** with your vector store bucket

7. **Review and Create**
8. **Important**: After creation, click **Sync** to ingest your documents
9. **Wait for sync completion** (this may take 10-30 minutes depending on document count)
10. **Note down the Knowledge Base ID** from the details page (format: XXXXXXXXXX)

### Step 3: Verify Knowledge Base
1. Go to the Knowledge Base details page
2. Ensure **Status** shows as "Available"
3. Check **Data source** shows successful sync

## Deployment Options

### Option 1: AWS CloudShell (Recommended)
1. Open AWS CloudShell from the AWS Console
2. No additional configuration needed - credentials are automatically inherited
3. Optionally set your region: `export AWS_DEFAULT_REGION=us-west-2`
4. Clone your repository and proceed with deployment

### Option 2: Local Machine
Requires AWS CLI installed and configured with `aws configure`

## Required AWS Permissions

### For AWS CLI User (aws configure) or CloudShell User
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
        "iam:PassRole",
        "iam:PutRolePolicy",
        "iam:DeleteRole",
        "iam:DeleteRolePolicy"
      ],
      "Resource": "*"
    }
  ]
}
```

**CodeBuild Permissions**:
```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "codebuild:CreateProject",
        "codebuild:StartBuild",
        "codebuild:BatchGetBuilds",
        "codebuild:DeleteProject",
        "codebuild:ListProjects"
      ],
      "Resource": "*"
    }
  ]
}
```

**S3 Permissions** (for source code storage):
```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "s3:CreateBucket",
        "s3:DeleteBucket",
        "s3:PutObject",
        "s3:GetObject",
        "s3:DeleteObject",
        "s3:ListBucket"
      ],
      "Resource": "*"
    }
  ]
}
```

**CloudFormation Permissions**:
```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "cloudformation:DescribeStacks",
        "cloudformation:DescribeStackResources",
        "cloudformation:DescribeStackEvents"
      ],
      "Resource": "*"
    }
  ]
}
```

## Environment Variables

### Backend Environment Variables
The deployment script will prompt for these values (no need to create .env files manually):
- **Knowledge Base ID**: Your Bedrock Knowledge Base ID
- **Documents Bucket**: S3 bucket name for document storage
- **GitHub Owner**: ASUCICREPO (hardcoded)
- **GitHub Repo**: IECHO-RAG-CHATBOT (hardcoded)

For local development, copy `backend/.env.example` to `backend/.env.local` and configure:
- AWS_REGION, AWS_ACCOUNT_ID
- KNOWLEDGE_BASE_ID, FEEDBACK_TABLE_NAME
- LOG_GROUP (for CloudWatch logging)

### Frontend Environment Variables (Local Development)
Copy `frontend/.env.example` to `frontend/.env.local`:
```bash
# API Base URL - The backend API Gateway URL (obtained after deployment)
NEXT_PUBLIC_API_BASE_URL=https://your-api-gateway-url.execute-api.region.amazonaws.com/prod/
```

## Deployment Steps

### 1. Clone Repository
```bash
git clone https://github.com/ASUCICREPO/IECHO-RAG-CHATBOT.git
cd IECHO-RAG-CHATBOT
```

### 2. Make Scripts Executable
```bash
chmod +x deploy.sh
chmod +x cleanup.sh
```

### 3. Run Deployment
```bash
./deploy.sh
```

The script will prompt you for:
- **Knowledge Base ID**: Your Bedrock Knowledge Base ID (format: XXXXXXXXXX)
- **Documents Bucket**: S3 bucket name for document storage

### 4. Monitor Deployment
The deployment process includes:
1. **IAM Role Creation**: Creates CodeBuild service role with least-privilege permissions
2. **Backend Deployment**: Deploys CDK infrastructure via CodeBuild (buildspec.yml)
3. **Frontend Deployment**: Builds and deploys Next.js app to Amplify (buildspec-frontend.yml)

Monitor progress via:
- Console output with build URLs
- AWS CodeBuild console
- AWS CloudFormation console

## Deployment Architecture

### Build Process
1. **deploy.sh** creates CodeBuild projects with specific IAM permissions
2. **buildspec.yml** handles backend CDK deployment (FastAPI app in docker/app/)
3. **buildspec-frontend.yml** handles frontend Amplify deployment only
4. Both buildspecs are kept for monitoring/debugging purposes

### Security
- **Least Privilege IAM**: Custom IAM policy with only required permissions (no PowerUserAccess)
- **Service-Specific Permissions**: Each AWS service gets only necessary actions
- **Temporary Resources**: S3 buckets cleaned up after deployment

## Post-Deployment

### Accessing Your Application
After successful deployment, you'll receive:
- **API Gateway URL**: Backend API endpoint
- **Amplify App URL**: Frontend web application
- **CodeBuild Project Names**: For monitoring future deployments

### Testing
1. **Frontend**: Access the Amplify URL to test the web interface
2. **API**: Test API endpoints using the Gateway URL
3. **Local Development**: Use `.env.local` with API Gateway URL for local frontend development

## Cleanup

### Complete Cleanup
```bash
./cleanup.sh
```

This will:
1. Clean up CodeBuild projects first
2. Remove S3 source buckets
3. Handle EKS and network dependencies
4. Clean up security group rules
5. Destroy CloudFormation stack via CDK destroy with retry logic
6. Clean up IAM roles

### Cleanup Process
The cleanup script uses a smart approach:
1. **First attempt**: CDK destroy (handles proper resource deletion order)
2. **If it fails**: Clean up security group dependencies and retry CDK destroy
3. **Final cleanup**: Remove any remaining CodeBuild projects and IAM roles

### Manual Cleanup (if needed)
If automated cleanup fails:
1. Check AWS CloudFormation console for stuck resources
2. Look for security group dependency issues
3. Check EKS cluster deletion status
4. Verify VPC resources are properly removed

## Troubleshooting

### Common Issues

**CodeBuild Role Issues**:
- Ensure IAM permissions are correctly set
- Wait 10 seconds after role creation for propagation (handled automatically)

**Frontend Build Failures**:
- Check buildspec-frontend.yml syntax
- Verify Amplify app creation succeeded (no GitHub integration)
- Check environment variables are passed correctly

**CDK Deployment Failures**:
- Verify Knowledge Base ID exists and is accessible
- Check S3 bucket permissions and existence
- Ensure EKS service limits aren't exceeded

**Cleanup Issues**:
- Security groups may have dependencies - script handles this automatically with retry logic
- EKS resources may take time to delete - CDK handles proper ordering
- Check CloudFormation events for specific failure reasons

**YAML Syntax Errors**:
- Buildspec files use specific YAML syntax
- Multi-line commands use proper formatting
- Environment variables are correctly passed

### Getting Help
- Check AWS CloudFormation events for detailed error messages
- Review CodeBuild logs via the provided console URLs
- Verify all prerequisites are met before deployment
- Ensure Knowledge Base ID and Documents Bucket exist and are accessible

### Accessing Logs for Troubleshooting

**CodeBuild Logs** (during deployment):
```bash
# View logs for backend deployment
aws logs tail /aws/codebuild/iecho-rag-[timestamp]-main --follow

# View logs for frontend deployment  
aws logs tail /aws/codebuild/iecho-rag-[timestamp]-frontend --follow
```

**Application Logs** (after deployment):
```bash
# EKS application logs
aws logs tail /aws/containerinsights/[cluster-name]/application --follow

# API Gateway logs
aws logs tail API-Gateway-Execution-Logs_[api-id]/prod --follow

# Lambda function logs (office-to-PDF)
aws logs tail /aws/lambda/AgentFargateStack-OfficeToPDF --follow
```

**CloudWatch Log Groups**:
- `/aws/codebuild/[project-name]` - Build and deployment logs
- `/aws/eks/[cluster-name]/cluster` - EKS cluster logs  
- `/aws/containerinsights/[cluster-name]/application` - Application container logs
- `/aws/lambda/[function-name]` - Lambda function logs
- `API-Gateway-Execution-Logs_[api-id]/prod` - API Gateway execution logs

**Viewing Logs in AWS Console**:
1. Go to **CloudWatch** → **Log groups**
2. Find the relevant log group from the list above
3. Click on the log group to view log streams
4. Select the most recent log stream for current logs

## Infrastructure Components Deployed

- **EKS Fargate Cluster**: Kubernetes cluster with Fargate profiles
- **VPC**: Multi-AZ setup with public/private subnets and NAT Gateway
- **Application Load Balancer**: Routes traffic to EKS services
- **API Gateway**: REST API with CORS, proxies to ALB
- **Amplify App**: Frontend hosting (no GitHub integration, manual deployment)
- **DynamoDB**: Feedback storage with TTL
- **CloudWatch**: Comprehensive logging
- **Lambda Functions**: Document processing (office-to-PDF conversion)
- **IAM Roles**: Least-privilege service roles for all components
