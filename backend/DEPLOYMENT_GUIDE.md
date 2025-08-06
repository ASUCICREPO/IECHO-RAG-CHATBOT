# iECHO RAG Chatbot - Complete Deployment Guide

## 🎯 Overview

This guide provides step-by-step instructions for deploying the iECHO RAG Chatbot using **EKS Auto Mode** with **S3 Vector Store** and **Amazon Nova Lite** model.

## 📋 Prerequisites

### Required Tools
- AWS CLI configured with appropriate permissions
- eksctl (latest version)
- kubectl
- Helm 3.x
- Docker
- jq (for JSON parsing)

### AWS Permissions Required
- EKS cluster creation and management
- ECR repository creation and image push
- S3 bucket creation and management
- DynamoDB table creation
- IAM role and policy management
- Bedrock model access and Knowledge Base creation
- Application Load Balancer creation

## 🏗 Architecture

```
User Request → ALB → EKS Fargate Pods → Nova Lite (Inference Profile)
                                           ↓
                                    Bedrock Knowledge Base
                                           ↓
                                    S3 Vector Store
                                           ↓
                                    Response + Citations
```

### Components
- **EKS Auto Mode**: Fully managed Kubernetes with Fargate
- **S3 Vector Store**: Cost-effective vector storage (vs OpenSearch)
- **Nova Lite**: Amazon's foundation model via inference profile
- **Application Load Balancer**: High availability and scaling
- **DynamoDB**: User feedback storage
- **ECR**: Container image registry

## 🚀 Deployment Steps

### Step 1: Create Knowledge Base Manually

**Why Manual?** S3 Vector Store creation via CLI has syntax complexities. Manual creation is more reliable.

1. **Go to AWS Console** → Amazon Bedrock → Knowledge bases
2. **Click "Create knowledge base"**
3. **Configuration:**
   - **Name**: `iecho-s3-vector-kb`
   - **Description**: `iECHO RAG Chatbot Knowledge Base`
   - **IAM Role**: Create new service role
4. **Data Source:**
   - **Type**: S3
   - **Bucket**: Will be created by deployment script
   - **Inclusion Prefix**: `processed/`
5. **Vector Store:**
   - **Type**: S3 Vector Store
   - **Embedding Model**: Titan Text Embeddings v2
6. **Note the Knowledge Base ID** (format: `XXXXXXXXXX`)

### Step 2: Run Deployment Script

```bash
# Navigate to project directory
cd /path/to/strands-iecho

# Run deployment with your Knowledge Base ID
./deploy.sh YOUR_KNOWLEDGE_BASE_ID

# Example:
./deploy.sh VEBRQICW1Y
```

### Step 3: Upload Test Documents

```bash
# Upload a simple text document
echo "Artificial Intelligence Overview

Artificial intelligence (AI) is a branch of computer science that aims to create intelligent machines that can perform tasks that typically require human intelligence.

Key concepts in AI include:
- Machine Learning: Algorithms that learn from data
- Natural Language Processing: Understanding human language
- Computer Vision: Interpreting visual information
- Robotics: Creating intelligent physical systems

AI applications are found in many industries including healthcare, finance, transportation, and entertainment." > ai-overview.txt

# Upload to S3
aws s3 cp ai-overview.txt s3://iecho-documents-{ACCOUNT-ID}-us-west-2/processed/
```

### Step 4: Sync Knowledge Base

1. **Go to AWS Console** → Bedrock → Knowledge bases → Your KB
2. **Click on Data Source**
3. **Click "Sync"** to ingest the uploaded document
4. **Wait for sync to complete** (usually 1-2 minutes)

### Step 5: Test the System

```bash
# Test health endpoint
curl http://YOUR_ALB_URL/health

# Test chat endpoint
curl -X POST http://YOUR_ALB_URL/chat \
  -H 'Content-Type: application/json' \
  -d '{
    "query": "What is artificial intelligence?",
    "userId": "test-user-123"
  }'

# Test feedback endpoint
curl -X POST http://YOUR_ALB_URL/feedback \
  -H 'Content-Type: application/json' \
  -d '{
    "userId": "test-user-123",
    "responseId": "response-456",
    "rating": 5,
    "feedback": "Great response!"
  }'

# List documents
curl http://YOUR_ALB_URL/documents
```

## 📊 What Gets Created

### AWS Resources
- **EKS Auto Mode Cluster**: `iecho-rag-cluster`
- **S3 Bucket**: `iecho-documents-{account-id}-us-west-2`
- **DynamoDB Table**: `iecho-feedback-table`
- **ECR Repository**: `iecho-rag-chatbot`
- **Application Load Balancer**: Auto-created by EKS
- **IAM Roles**: Pod Identity for secure AWS access

### Kubernetes Resources
- **Deployment**: 2 replicas with auto-scaling
- **Service**: ClusterIP for internal communication
- **Ingress**: ALB integration
- **ServiceAccount**: For Pod Identity
- **PodDisruptionBudget**: High availability

## 🔧 Configuration

### Environment Variables
- `KNOWLEDGE_BASE_ID`: Your Bedrock Knowledge Base ID
- `DOCUMENTS_BUCKET`: S3 bucket for documents
- `FEEDBACK_TABLE_NAME`: DynamoDB table name
- `AWS_REGION`: AWS region (us-west-2)
- `AWS_ACCOUNT_ID`: Your AWS account ID

### Nova Lite Configuration
The system uses Nova Lite inference profile:
```
arn:aws:bedrock:us-west-2:{account-id}:inference-profile/us.amazon.nova-lite-v1:0
```

## 📈 Monitoring

### Health Checks
```bash
# Check pod status
kubectl get pods

# Check deployment status
kubectl get deployment

# Check ingress status
kubectl get ingress

# View logs
kubectl logs -l app.kubernetes.io/name=iecho-rag-chatbot
```

### AWS Resources
```bash
# Check ALB status
aws elbv2 describe-load-balancers --region us-west-2

# Check Knowledge Base status
aws bedrock-agent get-knowledge-base --knowledge-base-id YOUR_KB_ID --region us-west-2

# Check ingestion jobs
aws bedrock-agent list-ingestion-jobs --knowledge-base-id YOUR_KB_ID --data-source-id YOUR_DS_ID --region us-west-2
```

## 💰 Cost Optimization

### Monthly Costs (Estimated)
- **EKS Cluster**: ~$75/month
- **Fargate Compute**: ~$10-30/month
- **DynamoDB**: ~$5-15/month
- **ALB**: ~$20/month
- **S3 Storage**: ~$5-20/month
- **Total**: ~$115-160/month

### Cost Savings vs Alternatives
- **S3 Vector Store vs OpenSearch**: ~$45-75/month savings
- **EKS Auto Mode vs Managed Nodes**: ~$50-100/month savings
- **Fargate vs EC2**: No idle compute costs

## 🔒 Security Features

- **Pod Identity**: Secure AWS service access
- **Private Subnets**: Fargate pods in private networks
- **IAM Least Privilege**: Minimal required permissions
- **Encryption**: At rest and in transit
- **VPC Isolation**: Network-level security

## 🚨 Troubleshooting

### Common Issues

1. **Knowledge Base Sync Fails**
   - Check document metadata size (< 2KB filterable)
   - Ensure documents are in `processed/` folder
   - Verify S3 bucket permissions

2. **Chat Returns "Unable to assist"**
   - Verify Knowledge Base has documents
   - Check ingestion job status
   - Ensure Nova Lite permissions

3. **ALB Not Accessible**
   - Wait 2-3 minutes for ALB provisioning
   - Check security groups
   - Verify ingress configuration

4. **Pods Not Starting**
   - Check ECR image availability
   - Verify Fargate profiles
   - Check resource limits

### Debug Commands
```bash
# Check pod logs
kubectl logs -l app.kubernetes.io/name=iecho-rag-chatbot --tail=100

# Describe pod issues
kubectl describe pods -l app.kubernetes.io/name=iecho-rag-chatbot

# Check ingress events
kubectl describe ingress iecho-rag-chatbot

# Test via port-forward
kubectl port-forward deployment/iecho-rag-chatbot 8080:8000
curl http://localhost:8080/health
```

## 🔄 Updates and Maintenance

### Updating the Application
```bash
# Update code and redeploy
./deploy.sh YOUR_KNOWLEDGE_BASE_ID

# Or update just the image
kubectl set image deployment/iecho-rag-chatbot iecho-rag-chatbot=NEW_IMAGE_TAG
```

### Scaling
```bash
# Scale replicas
kubectl scale deployment iecho-rag-chatbot --replicas=5

# Update resource limits
helm upgrade iecho-rag-chatbot ./chart --set resources.limits.memory=2Gi
```

## 🧹 Cleanup

When you're done testing:
```bash
./cleanup.sh
```

This removes all AWS resources to avoid ongoing charges.

## 📚 Additional Resources

- [Amazon Bedrock Documentation](https://docs.aws.amazon.com/bedrock/)
- [EKS Auto Mode Guide](https://docs.aws.amazon.com/eks/latest/userguide/auto-mode.html)
- [S3 Vector Store Limits](https://docs.aws.amazon.com/bedrock/latest/userguide/knowledge-base-s3-vectors.html)
- [Nova Lite Model Guide](https://docs.aws.amazon.com/bedrock/latest/userguide/model-parameters-nova.html)

---

**Need Help?** Check the `TROUBLESHOOTING_FIXES.md` for detailed solutions to common issues.
