# iECHO RAG Chatbot - Production Ready

A modern AI-powered document processing and chat API built on AWS, featuring **EKS Auto Mode**, **S3 Vector Store**, **Amazon Nova Lite** model, **API Gateway** integration, and **Lambda-powered document processing**.

## 🎯 Quick Start

### Option 1: Basic Deployment (Development)
```bash
# Create Knowledge Base manually (5 minutes)
# Go to AWS Console > Amazon Bedrock > Knowledge bases
# Create with S3 Vector Store type, note the Knowledge Base ID

# Basic deployment with ALB only
./deploy.sh YOUR_KNOWLEDGE_BASE_ID
```

### Option 2: Production Deployment (API Gateway)
```bash
# Production deployment with API Gateway
./deploy.sh YOUR_KNOWLEDGE_BASE_ID --with-api-gateway
```

### Option 3: With Document Processing (Lambda)
```bash
# Deployment with Lambda for automatic PPT to PDF conversion
./deploy.sh YOUR_KNOWLEDGE_BASE_ID --with-lambda
```

### Option 4: Full Production (Everything)
```bash
# Complete production setup with API Gateway + Lambda
./deploy.sh YOUR_KNOWLEDGE_BASE_ID --full-production
```

## 📁 Project Structure

```
strands-iecho/
├── deploy.sh                   # ✨ Unified deployment script (ALL options)
├── cleanup.sh                  # ✨ Unified cleanup script (ALL options)
├── DEPLOYMENT_GUIDE.md         # Step-by-step deployment guide
├── API_GATEWAY_GUIDE.md        # API Gateway integration guide
├── LAMBDA_GUIDE.md             # Lambda document processing guide
├── TROUBLESHOOTING_FIXES.md    # All issues and solutions
├── README.md                   # This file
├── docker/                     # Application container
│   ├── app/
│   │   └── app.py              # FastAPI app with Nova Lite support
│   ├── Dockerfile
│   └── requirements.txt
├── lambda/                     # Lambda function for document processing
│   ├── document-processor/
│   │   ├── lambda_function.py  # PPT to PDF conversion logic
│   │   └── requirements.txt
│   ├── build-lambda.sh         # Lambda package builder
│   └── build-libreoffice-layer.sh  # LibreOffice layer builder
└── chart/                      # Helm chart for Kubernetes deployment
    ├── Chart.yaml
    ├── values.yaml
    └── templates/
```

## 🏗 Architecture

### Full Production (--full-production)
```
User uploads PPT → S3 uploads/ → Lambda → LibreOffice → PDF in processed/
                                                              ↓
Client → API Gateway → ALB → EKS Fargate → Nova Lite → S3 Vector Store → Citations
                                    ↓
                               DynamoDB (Feedback)
```

### With API Gateway (--with-api-gateway)
```
Client → API Gateway → ALB → EKS Fargate → Nova Lite → S3 Vector Store → Citations
                                    ↓
                               DynamoDB (Feedback)
```

### With Lambda (--with-lambda)
```
User uploads PPT → S3 uploads/ → Lambda → LibreOffice → PDF in processed/
                                                              ↓
Client → ALB → EKS Fargate → Nova Lite → S3 Vector Store → Citations
                    ↓
               DynamoDB (Feedback)
```

### Basic (default)
```
Client → ALB → EKS Fargate → Nova Lite → S3 Vector Store → Citations
                    ↓
               DynamoDB (Feedback)
```

### Key Components
- **🌐 API Gateway**: Enterprise API management, security, monitoring (optional)
- **🔧 Lambda Function**: Automatic PPT to PDF conversion (optional)
- **⚖️ Application Load Balancer**: High availability and auto-scaling
- **☸️ EKS Auto Mode**: Fully managed Kubernetes with Fargate
- **🗄️ S3 Vector Store**: Cost-effective vector storage (~$5-20/month vs ~$50-100 for OpenSearch)
- **🤖 Nova Lite**: Amazon's foundation model via inference profile
- **📊 DynamoDB**: User feedback and response ratings

## ✨ Features

### Core Features
- 🤖 **Nova Lite Integration**: Latest Amazon foundation model
- 📄 **Multi-format Support**: PDF, TXT, MD, HTML, DOCX documents
- 🔍 **S3 Vector Store**: Cost-effective semantic search
- 📊 **User Feedback**: Rating and feedback system
- 🚀 **Auto-scaling**: EKS Fargate with horizontal pod autoscaling
- 🔒 **Security**: Pod Identity, encryption, VPC isolation

### API Gateway Features (--with-api-gateway)
- 🔒 **Security**: API keys, throttling, request validation
- 📈 **Rate Limiting**: Configurable limits and quotas
- 🌐 **CORS Support**: Built-in CORS for web applications
- 📊 **Monitoring**: CloudWatch metrics and logging
- 🔧 **Management**: Centralized API versioning
- 💰 **Cost Control**: Usage plans and quotas

### Lambda Document Processing (--with-lambda)
- 📄 **PPT to PDF Conversion**: Automatic PowerPoint to PDF conversion
- 🔄 **Auto-processing**: Files uploaded to `uploads/` folder are automatically processed
- 📁 **Multi-format Support**: PPT, PPTX, PDF, TXT, MD, HTML, DOCX
- 🔗 **Knowledge Base Integration**: Automatic sync after processing
- 📊 **Monitoring**: CloudWatch logs and metrics

## 🚀 Deployment Options

### Show Help
```bash
./deploy.sh --help
```

### Basic Development
```bash
# ALB only - fastest deployment
./deploy.sh VEBRQICW1Y
```

### Production API
```bash
# With API Gateway for production
./deploy.sh VEBRQICW1Y --with-api-gateway
```

### Document Processing
```bash
# With Lambda for PPT conversion
./deploy.sh VEBRQICW1Y --with-lambda
```

### Complete Production
```bash
# Everything: API Gateway + Lambda
./deploy.sh VEBRQICW1Y --full-production
```

### ALB Only (Explicit)
```bash
# Explicitly specify ALB only
./deploy.sh VEBRQICW1Y --alb-only
```

## 🔗 API Endpoints

Your deployment will provide endpoints via ALB and optionally API Gateway:

### Available Endpoints

#### Health Check
```bash
GET /health
```

#### System Status
```bash
GET /status
```

#### Chat with Nova Lite
```bash
POST /chat
{
  "query": "What is artificial intelligence?",
  "userId": "user-123",
  "sessionId": "optional"
}
```

#### Submit Feedback
```bash
POST /feedback
{
  "userId": "user-123",
  "responseId": "response-456",
  "rating": 5,
  "feedback": "Great response!"
}
```

#### List Documents
```bash
GET /documents
```

## 📄 Document Processing

### With Lambda Function (--with-lambda or --full-production)
```bash
# Upload PPT files - automatically converted to PDF
aws s3 cp presentation.pptx s3://your-bucket/uploads/

# Upload other formats - moved directly to processed
aws s3 cp document.pdf s3://your-bucket/uploads/
aws s3 cp article.txt s3://your-bucket/uploads/

# Lambda automatically:
# 1. Converts PPT/PPTX to PDF using LibreOffice
# 2. Moves all files to processed/ folder
# 3. Triggers Knowledge Base sync
# 4. Files ready for chat queries
```

### Manual Processing (Basic deployment)
```bash
# Upload directly to processed folder
aws s3 cp your-document.pdf s3://your-bucket/processed/

# Manually sync Knowledge Base via AWS Console
```

## 🚀 Example Usage

After deployment, you'll get URLs for access:

### Via API Gateway (Production)
```bash
# Example URL: https://abc123.execute-api.us-west-2.amazonaws.com/prod

# Health check
curl https://YOUR_API_GATEWAY_URL/health

# Chat with Nova Lite
curl -X POST https://YOUR_API_GATEWAY_URL/chat \
  -H 'Content-Type: application/json' \
  -d '{
    "query": "What is machine learning?",
    "userId": "api-user"
  }'
```

### Via Direct ALB Access (Development)
```bash
# Example URL: http://k8s-default-iechorag-xyz.us-west-2.elb.amazonaws.com

# Health check
curl http://YOUR_ALB_URL/health

# Chat with Nova Lite
curl -X POST http://YOUR_ALB_URL/chat \
  -H 'Content-Type: application/json' \
  -d '{
    "query": "What is machine learning?",
    "userId": "direct-user"
  }'
```

## 📊 S3 Vector Store Limits

| Limit | Value | Impact |
|-------|-------|--------|
| Vectors per index | 50 million | Massive document capacity |
| Filterable metadata | 2KB per vector | Keep document metadata minimal |
| Write throughput | 5 requests/sec | ~18K documents/hour ingestion |
| Query results | 30 top-K max | Sufficient for most use cases |

## 🚨 Common Issues & Solutions

### 1. Document Ingestion Fails
**Error**: "Filterable metadata must have at most 2048 bytes"
**Solution**: Use simple text documents, avoid complex PDFs

### 2. Nova Lite Access Denied
**Error**: "Invocation of model ID amazon.nova-lite-v1:0 with on-demand throughput isn't supported"
**Solution**: Uses inference profile (automatically handled in deployment)

### 3. API Gateway 502 Error
**Error**: Bad Gateway from API Gateway
**Solution**: Check ALB health and security groups

### 4. PPT Conversion Fails
**Error**: Lambda function fails to convert PPT to PDF
**Solution**: Check LibreOffice layer attachment and file size limits

### 5. CORS Issues
**Error**: CORS policy blocks request
**Solution**: API Gateway includes CORS support automatically

See `TROUBLESHOOTING_FIXES.md` for complete solutions.

## 📈 Monitoring

### Kubernetes Monitoring
```bash
# Check pod status
kubectl get pods

# View logs
kubectl logs -l app.kubernetes.io/name=iecho-rag-chatbot

# Check ingress
kubectl get ingress
```

### API Gateway Monitoring (if deployed)
```bash
# CloudWatch metrics
aws cloudwatch get-metric-statistics \
  --namespace AWS/ApiGateway \
  --metric-name Count \
  --start-time 2025-01-01T00:00:00Z \
  --end-time 2025-01-01T01:00:00Z \
  --period 3600 \
  --statistics Sum
```

### Lambda Function Monitoring (if deployed)
```bash
# View Lambda logs
aws logs tail /aws/lambda/iecho-document-processor --follow --region us-west-2

# Check function status
aws lambda get-function --function-name iecho-document-processor --region us-west-2
```

### Knowledge Base Monitoring
```bash
# Monitor ingestion jobs
aws bedrock-agent list-ingestion-jobs --knowledge-base-id YOUR_KB_ID --region us-west-2
```

## 💰 Cost Breakdown

### Monthly Estimates

#### Core Infrastructure
- **EKS Cluster**: ~$75
- **Fargate Compute**: ~$10-30
- **DynamoDB**: ~$5-15
- **ALB**: ~$20
- **S3 Storage**: ~$5-20

#### API Gateway (Optional)
- **10K requests/day**: ~$1/month
- **100K requests/day**: ~$10/month
- **1M requests/day**: ~$105/month

#### Lambda Function (Optional)
- **Document Processing**: ~$0.01 per 100 conversions
- **LibreOffice Layer**: ~$0.01/month storage

#### Total Cost by Deployment Type
- **Basic (ALB only)**: ~$115-160/month
- **With API Gateway**: ~$116-170/month
- **With Lambda**: ~$116-165/month
- **Full Production**: ~$117-175/month

### Cost Savings
- **S3 Vector Store vs OpenSearch**: ~$45-75/month saved
- **EKS Auto Mode vs Managed Nodes**: ~$50-100/month saved

## 🧹 Cleanup

### Show Cleanup Options
```bash
./cleanup.sh --help
```

### Complete Cleanup (Recommended)
```bash
# Interactive cleanup - removes everything
./cleanup.sh
```

### Force Cleanup (Non-interactive)
```bash
# Skip confirmation prompt
./cleanup.sh --force
```

### Selective Cleanup
```bash
# Keep API Gateway, cleanup everything else
./cleanup.sh --keep-api-gateway

# Keep Lambda function, cleanup everything else
./cleanup.sh --keep-lambda
```

## 📚 Documentation

- **[DEPLOYMENT_GUIDE.md](DEPLOYMENT_GUIDE.md)**: Complete step-by-step deployment
- **[API_GATEWAY_GUIDE.md](API_GATEWAY_GUIDE.md)**: API Gateway integration guide
- **[LAMBDA_GUIDE.md](LAMBDA_GUIDE.md)**: Lambda document processing guide
- **[TROUBLESHOOTING_FIXES.md](TROUBLESHOOTING_FIXES.md)**: All issues and solutions
- **[AWS Bedrock Documentation](https://docs.aws.amazon.com/bedrock/)**
- **[EKS Auto Mode Guide](https://docs.aws.amazon.com/eks/latest/userguide/auto-mode.html)**
- **[API Gateway Documentation](https://docs.aws.amazon.com/apigateway/)**

## 🎯 Production Readiness

### Core Features
✅ **High Availability**: Multi-AZ deployment with ALB  
✅ **Auto-scaling**: Horizontal pod autoscaling  
✅ **Security**: Pod Identity, encryption, VPC isolation  
✅ **Monitoring**: CloudWatch logs and metrics  
✅ **Cost Optimized**: S3 Vector Store + EKS Auto Mode  
✅ **Latest Models**: Nova Lite with inference profiles  

### API Gateway Features (Optional)
✅ **Enterprise API Management**: Rate limiting, quotas, keys  
✅ **CORS Support**: Ready for web applications  
✅ **Request Validation**: Input validation and sanitization  
✅ **Monitoring & Alerting**: CloudWatch integration  
✅ **Custom Domains**: Support for branded URLs  
✅ **Caching**: Response caching for better performance  

### Lambda Processing Features (Optional)
✅ **Automatic Conversion**: PPT to PDF conversion  
✅ **Multi-format Support**: PPT, PPTX, PDF, TXT, MD, HTML, DOCX  
✅ **Auto-sync**: Knowledge Base integration  
✅ **Error Handling**: Comprehensive logging and recovery  
✅ **Cost Effective**: Pay per conversion (~$0.01 per 100 files)  

## 🎯 Deployment Decision Guide

### Choose Basic (default) When:
- 🔧 **Development/Testing**: Quick iterations and testing
- 💰 **Cost Sensitive**: Minimal costs
- 🚀 **Simple Setup**: Fastest deployment
- 📄 **Manual Documents**: You'll upload PDFs directly

### Choose --with-api-gateway When:
- 🏢 **Production**: External-facing APIs
- 🔒 **Security**: Need API keys, rate limiting
- 📊 **Monitoring**: Detailed API analytics required
- 🌐 **Web Apps**: CORS support needed
- 📈 **Scaling**: Advanced traffic management

### Choose --with-lambda When:
- 📄 **PPT Files**: Need to process PowerPoint presentations
- 🔄 **Automation**: Want automatic document processing
- 📁 **Mixed Formats**: Handle multiple document types
- 🚀 **User-Friendly**: Non-technical users uploading files

### Choose --full-production When:
- 🏢 **Enterprise**: Complete production deployment
- 🔒 **Security + Automation**: Need both API management and document processing
- 📊 **Comprehensive**: Want all features enabled
- 💼 **Business Ready**: Ready for end-users

## 🚀 Next Steps

1. **Choose Deployment**: Pick the right option for your needs
2. **Deploy**: Run `./deploy.sh YOUR_KB_ID [OPTIONS]`
3. **Upload Documents**: Add content to S3 (uploads/ or processed/)
4. **Test**: Try the endpoints with your documents
5. **Monitor**: Check CloudWatch and kubectl logs
6. **Scale**: Adjust replicas and limits as needed

---

**Built with ❤️ for production workloads on AWS with unified deployment and complete automation** 🚀
