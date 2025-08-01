# iECHO RAG Chatbot

A comprehensive AI-powered document processing and chat API built on AWS, featuring multi-modal document ingestion, vector search, and intelligent conversational AI powered by Amazon Bedrock.

## Project Structure

```
iECHO-RAG-CHATBOT/
├── backend/                    # Backend infrastructure and services
│   ├── cdk-infrastructure/     # AWS CDK infrastructure code
│   ├── deploy.sh              # Automated deployment script
│   ├── cleanup.sh             # Infrastructure cleanup script
│   └── README.md              # Backend-specific documentation
├── README.md                  # This file - main project overview
└── PROJECT_STRUCTURE.md       # Detailed project structure documentation
```

## Architecture Overview

This system implements a modern RAG (Retrieval-Augmented Generation) backend architecture with the following components:

### API Layer
- **Amazon API Gateway**: RESTful API endpoints with CORS support
- **AWS Lambda**: Serverless compute for API processing
- **Application Load Balancer**: Load balancing for EKS services

### AI/ML Layer
- **Amazon Bedrock Knowledge Base**: Vector-based document retrieval
- **Amazon Nova Lite**: Foundation model for response generation
- **Titan Multimodal Embedding**: Document vectorization
- **Bedrock Data Automation**: Advanced document parsing and structure extraction
- **S3 Vector Store**: Scalable vector storage solution

### Compute Layer
- **Amazon EKS Fargate**: Containerized agent orchestration
- **AWS Lambda**: Document processing and API handling

### Storage Layer
- **Amazon S3**: Document storage and vector embeddings
- **Amazon DynamoDB**: User feedback and response ratings
- **CloudWatch Logs**: Centralized logging and monitoring

## Features

- 🤖 **Intelligent Chat API**: Natural language queries against your document corpus
- 📄 **Multi-format Support**: PDF and PowerPoint document processing
- 🔍 **Vector Search**: Semantic search across document content
- 📊 **User Feedback**: Rating and feedback system for responses
- 🚀 **Serverless Architecture**: Auto-scaling and cost-effective
- 🔒 **Security**: AWS IAM, encryption at rest and in transit
- 📈 **Monitoring**: CloudWatch integration for observability
- 💰 **Cost Optimized**: VPC endpoints instead of NAT Gateway (~$7/month vs ~$45/month)

## Quick Start

### Prerequisites

- AWS CLI configured with appropriate permissions
- Node.js 18+ and npm
- AWS CDK CLI installed (`npm install -g aws-cdk`)
- jq installed for JSON parsing (`brew install jq` on macOS, `apt-get install jq` on Ubuntu)

### 1. Deploy Backend Infrastructure

```bash
# Navigate to backend directory
cd backend

# Deploy CDK infrastructure only (no Knowledge Base creation)
cd cdk-infrastructure
npm install
cdk bootstrap  # First time only
cdk deploy --require-approval never
```

**Note**: The `deploy.sh` script is designed for CLI-based Knowledge Base creation, but since S3 Vectors requires manual setup through the AWS Console, we use the manual approach below.

### 2. Create Knowledge Base Manually

Since S3 Vectors is not yet supported in AWS CLI, create the Knowledge Base manually:

```bash
# Follow the detailed guide
cd backend
cat MANUAL_KB_SETUP.md
```

**Quick Steps:**
1. Go to AWS Console → Bedrock → Knowledge bases → Create
2. Use S3 Vectors with the deployed bucket: `iecho-vectors-138681986761-us-west-2`
3. Create data source pointing to: `s3://iecho-documents-138681986761-us-west-2/processed/`
4. Copy the Knowledge Base ID and Data Source ID

### 3. Update Configuration

```bash
# Run the configuration update script
cd backend
./update-configs.sh

# Enter the Knowledge Base ID and Data Source ID when prompted
```

### 4. Enable Bedrock Models

1. Go to AWS Console → Bedrock → Model access
2. Enable access to:
   - Amazon Titan Embed Text v2
   - Amazon Nova Lite

### 5. Test the API

```bash
# Health check
curl -X GET https://your-api-gateway-url/health

# Send a chat message
curl -X POST https://your-api-gateway-url/chat \
  -H "Content-Type: application/json" \
  -d '{"query": "What is the main topic of the uploaded documents?", "userId": "test-user"}'

# List processed documents
curl -X GET https://your-api-gateway-url/documents

# Submit feedback
curl -X POST https://your-api-gateway-url/feedback \
  -H "Content-Type: application/json" \
  -d '{"userId": "test-user", "responseId": "response-123", "rating": 5, "feedback": "Great response!"}'
```

## API Endpoints

### GET /health
Health check endpoint.

**Response:**
```json
{
  "status": "healthy",
  "service": "iECHO RAG Chatbot API"
}
```

### POST /chat
Send a chat message and receive AI-generated response.

**Request:**
```json
{
  "query": "What is the main topic of the uploaded documents?",
  "userId": "user-123",
  "sessionId": "optional-session-id"
}
```

**Response:**
```json
{
  "response": "Based on the uploaded documents...",
  "sessionId": "session-456",
  "citations": [
    {
      "title": "Document excerpt...",
      "source": "s3://bucket/document.pdf",
      "excerpt": "Relevant text excerpt..."
    }
  ],
  "userId": "user-123"
}
```

### POST /feedback
Submit user feedback for responses.

**Request:**
```json
{
  "userId": "user-123",
  "responseId": "response-456",
  "rating": 5,
  "feedback": "Very helpful response"
}
```

**Response:**
```json
{
  "message": "Feedback saved successfully"
}
```

### GET /documents
List processed documents in the knowledge base.

**Response:**
```json
{
  "documents": [
    {
      "key": "processed/document.pdf",
      "name": "document.pdf",
      "size": 1024000,
      "lastModified": "2024-01-15T10:30:00Z"
    }
  ],
  "count": 1
}
```

## Document Processing Workflow

1. **Upload**: Documents uploaded to S3 `uploads/` folder via AWS Console
2. **Trigger**: S3 event triggers Lambda function
3. **Processing**: PPT files converted to PDF format with enhanced structure
4. **Indexing**: Documents moved to `processed/` folder with metadata
5. **Data Automation**: Bedrock Data Automation parses document structure and content
6. **Vectorization**: Bedrock Knowledge Base ingests and vectorizes content using hierarchical chunking
7. **Ready**: Documents available for chat queries via API

## Configuration

### Environment Variables

**CDK Infrastructure:**
- `CDK_DEFAULT_ACCOUNT`: AWS account ID
- `CDK_DEFAULT_REGION`: AWS region (default: us-west-2)

### AWS Services Configuration

The CDK stack automatically configures:
- IAM roles and policies with least privilege
- S3 buckets with encryption and versioning
- DynamoDB with point-in-time recovery
- CloudWatch log groups with retention policies
- VPC and security groups for EKS

## Security Features

- **Encryption**: All data encrypted at rest and in transit
- **IAM**: Least privilege access controls
- **VPC**: Private subnets for backend services
- **API Gateway**: CORS and throttling configured
- **CDK Nag**: Security best practices validation

## Monitoring and Observability

- **CloudWatch Logs**: Centralized logging for all components
- **CloudWatch Metrics**: Performance and usage metrics
- **X-Ray Tracing**: Distributed tracing (can be enabled)
- **DynamoDB Insights**: Database performance monitoring

## Cost Optimization

- **Serverless**: Pay-per-use Lambda and API Gateway
- **S3 Lifecycle**: Automatic data archival policies
- **DynamoDB**: On-demand billing mode
- **EKS Fargate**: No EC2 instance management

## Troubleshooting

### Common Issues

1. **Documents not processing**: Check S3 event triggers and Lambda logs
2. **Chat API not working**: Verify API Gateway URL and CORS settings
3. **Knowledge Base empty**: Ensure documents are in `processed/` folder
4. **High costs**: Review CloudWatch metrics and optimize resource usage

### Debugging Steps

1. Check CloudWatch logs for error messages
2. Verify IAM permissions for all services
3. Test API endpoints directly with curl/Postman
4. Monitor DynamoDB and S3 access patterns

## Development

### Local Development

```bash
# CDK development
cd backend/cdk-infrastructure
npm run watch
```

### Testing

```bash
# CDK tests
cd backend/cdk-infrastructure
npm test
```

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests if applicable
5. Submit a pull request

## License

This project is licensed under the MIT License - see the LICENSE file for details.

## Support

For issues and questions:
1. Check the troubleshooting section
2. Review CloudWatch logs
3. Open an issue in the repository
4. Contact the development team

## Roadmap

- [ ] Advanced document analytics
- [ ] Real-time collaboration features
- [ ] Advanced security features (WAF, GuardDuty)
- [ ] Multi-language support
- [ ] Batch processing capabilities
