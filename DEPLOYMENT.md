# Backend API Deployment Guide

This guide provides step-by-step instructions for deploying the iECHO RAG Chatbot backend API to AWS.

## Prerequisites

Before starting the deployment, ensure you have:

1. **AWS Account**: Active AWS account with appropriate permissions
2. **AWS CLI**: Installed and configured with your credentials
3. **Node.js**: Version 18 or higher
4. **AWS CDK**: Installed globally (`npm install -g aws-cdk`)

## Step 1: Prepare Your Environment

### 1.1 Configure AWS CLI

```bash
aws configure
# Enter your AWS Access Key ID, Secret Access Key, region, and output format
```

### 1.2 Verify AWS Permissions

Ensure your AWS user/role has permissions for:
- CloudFormation
- S3
- Lambda
- API Gateway
- DynamoDB
- EKS
- Bedrock
- IAM
- CloudWatch

### 1.3 Set Environment Variables

```bash
export CDK_DEFAULT_ACCOUNT=$(aws sts get-caller-identity --query Account --output text)
export CDK_DEFAULT_REGION=us-east-1  # or your preferred region
```

## Step 2: Deploy Infrastructure

### 2.1 Install Dependencies

```bash
cd cdk-infrastructure
npm install
```

### 2.2 Bootstrap CDK (First Time Only)

```bash
cdk bootstrap
```

### 2.3 Synthesize CloudFormation Template

```bash
cdk synth
```

Review the generated CloudFormation template in `cdk.out/` directory.

### 2.4 Deploy the Stack

```bash
cdk deploy
```

This will create all AWS resources including:
- **EKS Fargate cluster** for 24/7 agent orchestration with Strands SDK
- **Bedrock Knowledge Base** with Data Automation parsing
- **Cost-optimized VPC** without NAT Gateway while maintaining ALB compliance
- **Document processing pipeline** with PPT to PDF conversion

The deployment typically takes 15-20 minutes.

### 2.5 Note the Outputs

After deployment, note the following outputs:
- `ApiGatewayUrl`: Your REST API endpoint
- `DocumentBucketName`: S3 bucket for document uploads
- `KnowledgeBaseId`: Bedrock Knowledge Base ID
- `FeedbackTableName`: DynamoDB table for feedback

## Step 3: Configure Bedrock

### 3.1 Enable Bedrock Models

1. Go to AWS Console → Bedrock → Model access
2. Enable access to:
   - Amazon Nova Lite
   - Titan Multimodal Embedding

### 3.2 Verify Knowledge Base

1. Go to AWS Console → Bedrock → Knowledge bases
2. Find your knowledge base (`iecho-multimodal-kb`)
3. Verify it's in "Active" status

## Step 4: Upload Test Documents

### 4.1 Access Document Bucket

1. Go to AWS Console → S3
2. Find bucket: `iecho-documents-{account}-{region}`
3. Create folder: `uploads/`

### 4.2 Upload Documents

1. Upload PDF or PowerPoint files to `uploads/` folder
2. Monitor CloudWatch logs for processing status
3. Check `processed/` folder for processed documents

### 4.3 Sync Knowledge Base

1. Go to AWS Console → Bedrock → Knowledge bases
2. Select your knowledge base
3. Go to Data sources tab
4. Click "Sync" to index uploaded documents

## Step 5: Test the API

### 5.1 Health Check

```bash
curl -X GET https://your-api-gateway-url/health
```

Expected response:
```json
{
  "status": "healthy",
  "service": "iECHO RAG Chatbot API"
}
```

### 5.2 Test Chat Functionality

```bash
curl -X POST https://your-api-gateway-url/chat \
  -H "Content-Type: application/json" \
  -d '{
    "query": "What is the main topic of the uploaded documents?",
    "userId": "test-user"
  }'
```

### 5.3 List Documents

```bash
curl -X GET https://your-api-gateway-url/documents
```

### 5.4 Submit Feedback

```bash
curl -X POST https://your-api-gateway-url/feedback \
  -H "Content-Type: application/json" \
  -d '{
    "userId": "test-user",
    "responseId": "response-123",
    "rating": 5,
    "feedback": "Great response!"
  }'
```

## Step 6: Production Considerations

### 6.1 Security Enhancements

- Enable WAF for API Gateway
- Set up VPC endpoints for private communication
- Enable GuardDuty for threat detection
- Configure API throttling and rate limiting

### 6.2 Monitoring Setup

- Configure CloudWatch alarms
- Set up SNS notifications
- Enable X-Ray tracing
- Configure log retention policies

### 6.3 Cost Optimization

- Set up S3 lifecycle policies
- Configure DynamoDB auto-scaling
- Monitor Bedrock usage costs
- Set up billing alerts
- **Architecture Benefits**: This deployment uses a cost-optimized architecture that eliminates NAT Gateway (~$45/month savings) while maintaining ALB compliance
- **EKS Fargate**: Provides 24/7 agent availability without Lambda cold start issues, optimizing conversational AI performance

## Troubleshooting

### Common Issues

1. **CDK Bootstrap Failed**
   ```bash
   # Try with explicit region
   cdk bootstrap aws://{account}/{region}
   ```

2. **Bedrock Access Denied**
   - Ensure models are enabled in Bedrock console
   - Check IAM permissions for Bedrock

3. **Knowledge Base Sync Failed**
   - Verify documents are in `processed/` folder
   - Check S3 bucket permissions
   - Review CloudWatch logs

4. **API Gateway 403 Errors**
   - Check CORS configuration
   - Verify API Gateway resource policies
   - Review Lambda function permissions

5. **Chat Not Working**
   - Verify Knowledge Base has indexed documents
   - Check Lambda function logs
   - Ensure Bedrock models are accessible

### Getting Help

1. Check CloudWatch logs for detailed error messages
2. Review AWS service quotas and limits
3. Verify all required AWS services are available in your region
4. Check the project's GitHub issues for known problems

## API Documentation

### Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/health` | Health check |
| POST | `/chat` | Send chat message |
| POST | `/feedback` | Submit feedback |
| GET | `/documents` | List processed documents |

### Authentication

Currently, the API does not require authentication. For production use, consider implementing:
- API Keys
- AWS IAM authentication
- Custom authorizers

## Cleanup

To remove all resources:

```bash
cd cdk-infrastructure
cdk destroy
```

**Warning**: This will delete all data including uploaded documents and chat history.

## Next Steps

After successful deployment:

1. Set up monitoring and alerting
2. Configure backup strategies
3. Implement authentication if needed
4. Add custom domain names
5. Set up CI/CD pipeline for updates
6. Consider implementing a frontend application
