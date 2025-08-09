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

## Deployment Steps

### 1. Create Knowledge Base (Manual)

1. Go to AWS Bedrock Console → Knowledge Bases
2. Create a new Knowledge Base with:
   - **Data Source**: S3 bucket with `/processed/TB` and `/processed/agriculture` folders
   - **Vector Store**: Any supported vector database
   - **Embedding Model**: Amazon Titan or similar
3. Note down the **Knowledge Base ID**

### 2. Deploy Infrastructure

```bash
# Clone repository
git clone <repository-url>
cd iECHO-RAG-CHATBOT/backend

# Install dependencies
npm install

# Bootstrap CDK (first time only)
cdk bootstrap

# Deploy with your Knowledge Base ID
cdk deploy -c knowledgeBaseId=YOUR_KNOWLEDGE_BASE_ID

# Or add to cdk.json:
# {
#   "context": {
#     "knowledgeBaseId": "YOUR_KNOWLEDGE_BASE_ID"
#   }
# }
```

### 3. Get API Endpoint

After deployment, note the `ApiGatewayUrl` from CDK outputs:
```
Outputs:
AgentEksFargateStack.ApiGatewayUrl = https://xxxxxxxxxx.execute-api.us-west-2.amazonaws.com/prod/
```

### 4. Test Deployment

```bash
# Health check
curl https://your-api-gateway-url/health

# Test chat
curl -X POST https://your-api-gateway-url/chat \
  -H "Content-Type: application/json" \
  -d '{
    "query": "What are the symptoms of TB?",
    "userId": "test-user"
  }'
```

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

## API Documentation

See [docs/API.md](docs/API.md) for detailed API specifications and examples.