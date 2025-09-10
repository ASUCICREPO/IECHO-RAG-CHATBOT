# Deployment Guide

## Prerequisites

- AWS CLI access (local installation with `aws configure` OR AWS CloudShell)
- Knowledge Base created manually in AWS Bedrock (see steps below)
- S3 bucket for documents (see steps below)

**Note**: Node.js, CDK CLI, Docker, and other build tools are handled automatically by the deploy.sh script via CodeBuild

**Time Requirements**:
- **Prerequisites Setup**: 10-15 minutes (Knowledge Base creation)
- **Deployment**: Up to 1 hour for complete infrastructure setup
- **Cleanup**: Up to 1 hour 30 minutes for complete resource removal

## IAM Policy Requirements

Before proceeding with manual setup, ensure your AWS user has the following custom policy attached:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "s3:*"
      ],
      "Resource": "*"
    },
    {
      "Effect": "Allow",
      "Action": [
        "s3vectors:*"
      ],
      "Resource": "*"
    },
    {
      "Effect": "Allow",
      "Action": [
        "bedrock:*",
        "bedrock-agent:*",
        "bedrock-agent-runtime:*"
      ],
      "Resource": "*"
    },
    {
      "Effect": "Allow",
      "Action": [
        "eks:*"
      ],
      "Resource": "*"
    },
    {
      "Effect": "Allow",
      "Action": [
        "ec2:*"
      ],
      "Resource": "*"
    },
    {
      "Effect": "Allow",
      "Action": [
        "iam:*"
      ],
      "Resource": "*"
    },
    {
      "Effect": "Allow",
      "Action": [
        "cloudformation:*"
      ],
      "Resource": "*"
    },
    {
      "Effect": "Allow",
      "Action": [
        "codebuild:*"
      ],
      "Resource": "*"
    },
    {
      "Effect": "Allow",
      "Action": [
        "ecr:*"
      ],
      "Resource": "*"
    },
    {
      "Effect": "Allow",
      "Action": [
        "logs:*",
        "cloudwatch:*"
      ],
      "Resource": "*"
    },
    {
      "Effect": "Allow",
      "Action": [
        "dynamodb:*"
      ],
      "Resource": "*"
    },
    {
      "Effect": "Allow",
      "Action": [
        "apigateway:*"
      ],
      "Resource": "*"
    },
    {
      "Effect": "Allow",
      "Action": [
        "lambda:*"
      ],
      "Resource": "*"
    },
    {
      "Effect": "Allow",
      "Action": [
        "amplify:*"
      ],
      "Resource": "*"
    },
    {
      "Effect": "Allow",
      "Action": [
        "elasticloadbalancing:*"
      ],
      "Resource": "*"
    },
    {
      "Effect": "Allow",
      "Action": [
        "sts:*"
      ],
      "Resource": "*"
    }
  ]
}
```

## Pre-Deployment Checks

### 1. Region Configuration
**Important**: This solution must be deployed in **us-west-2** region.

- **AWS Console**: Ensure you're logged into **us-west-2** region (check top-right corner)
- **AWS CLI**: Verify your default region is set to us-west-2:
  ```bash
  aws configure get region
  ```
  If not set to us-west-2, configure it:
  ```bash
  aws configure set region us-west-2
  ```

### 2. Bedrock Model Access
Verify you have access to required Bedrock models:
```bash
# Check Nova Lite model access
aws bedrock list-foundation-models --region us-west-2 --query 'modelSummaries[?contains(modelId, `nova-lite`)]'

# Check Titan Embeddings model access  
aws bedrock list-foundation-models --region us-west-2 --query 'modelSummaries[?contains(modelId, `titan-embed`)]'
```

If models are not available, request access in AWS Console:
1. Go to **Amazon Bedrock** → **Model access**
2. Request access for:
   - **Amazon Nova Lite** (for chat responses)
   - **Amazon Titan Embeddings G1 - Text** (for knowledge base)

## Step-by-Step Prerequisites Setup (Manual Setup)
First, log in to AWS Console

### Step 1: Create S3 Buckets

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
16. Click on folder name `"uploads/"`
17. Click on `"Upload"` button
18. Click on `"Add files"`
19. Select all the files that you want to upload
20. **Supported formats**: PDF, DOCX, XLSX, PPTX
21. Click on `"Upload"`, wait for files to be uploaded
22. Once uploaded, click on `"close"`
23. Now, your TB and Agriculture documents are uploaded in `"uploads/"` folder
    
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

### Step 2: Create Bedrock Knowledge Base

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

## Deployment Options

### Option 1: AWS CloudShell (Recommended)
1. Open AWS CloudShell from the AWS Console
2. No additional configuration needed - credentials are automatically inherited
3. Optionally set your region: `export AWS_DEFAULT_REGION=us-west-2`
4. Clone your repository and proceed with deployment

### Option 2: Local Machine
1. Install AWS CLI: https://docs.aws.amazon.com/cli/latest/userguide/getting-started-install.html
2. Configure AWS CLI with your credentials:
   ```bash
   aws configure
   ```
   Enter:
   - AWS Access Key ID
   - AWS Secret Access Key  
   - Default region (e.g., us-west-2)
   - Default output format (json)



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

The deployment process includes:
1. **IAM Role Creation**: Creates CodeBuild service role with least-privilege permissions
2. **Backend Deployment**: Deploys CDK infrastructure via CodeBuild (buildspec.yml)
3. **Frontend Deployment**: Builds and deploys Next.js app to Amplify (buildspec-frontend.yml)

### 4. Monitor Deployment
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

## Post-Deployment

### Accessing Your Application
After successful deployment, you'll receive:
- **API Gateway URL**: Backend API endpoint
- **Amplify App URL**: Frontend web application
- **CodeBuild Project Names**: For monitoring future deployments

### Testing
1. **Frontend**: Access the Amplify URL to test the web interface
2. **API**: Test API endpoints using the Gateway URL

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
# Agent application logs (main application)
aws logs tail /aws/eks/[cluster-name]/agent-service --follow

# EKS Fargate logs
aws logs tail /aws/eks/[cluster-name]/fargate --follow

# EKS cluster logs
aws logs tail /aws/eks/[cluster-name]/cluster --follow

# API Gateway logs
aws logs tail API-Gateway-Execution-Logs_[api-id]/prod --follow

# Lambda function logs (office-to-PDF conversion)
aws logs tail /aws/lambda/office-to-pdf-AgentFargateStack --follow
```

**CloudWatch Log Groups**:
- `/aws/codebuild/[project-name]` - Build and deployment logs
- `/aws/eks/[cluster-name]/agent-service` - Agent application logs
- `/aws/eks/[cluster-name]/fargate` - Fargate container logs
- `/aws/eks/[cluster-name]/cluster` - EKS cluster control plane logs
- `/aws/lambda/office-to-pdf-AgentFargateStack` - Lambda function logs
- `API-Gateway-Execution-Logs_[api-id]/prod` - API Gateway execution logs

**Viewing Logs in AWS Console**:
1. Go to **CloudWatch** → **Log groups**
2. Find the relevant log group from the list above
3. Click on the log group to view log streams
4. Select the most recent log stream for current logs

## Infrastructure Components Deployed by script

- **EKS Fargate Cluster**: Kubernetes cluster with Fargate profiles
- **VPC**: Multi-AZ setup with public/private subnets and NAT Gateway
- **Application Load Balancer**: Routes traffic to EKS services
- **API Gateway**: REST API with CORS, proxies to ALB
- **Amplify App**: Frontend hosting (no GitHub integration, manual deployment)
- **DynamoDB**: Feedback storage with TTL
- **CloudWatch**: Comprehensive logging
- **Lambda Functions**: Document processing (office-to-PDF conversion)
- **IAM Roles**: Least-privilege service roles for all components
