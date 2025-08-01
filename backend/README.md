# iECHO RAG Chatbot Backend

This directory contains all backend infrastructure and deployment components for the iECHO RAG Chatbot system.

## Architecture Overview

The backend implements a modern RAG (Retrieval-Augmented Generation) architecture with the following components:

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

## Directory Structure

```
backend/
├── cdk-infrastructure/          # AWS CDK infrastructure code
│   ├── lib/                    # CDK stack definitions
│   ├── bin/                    # CDK app entry point
│   ├── test/                   # Infrastructure tests
│   └── package.json            # CDK dependencies
├── deploy.sh                   # Automated deployment script
├── cleanup.sh                  # Infrastructure cleanup script
├── DEPLOYMENT.md               # Detailed deployment guide
├── IMPLEMENTATION_NOTES.md     # Technical implementation notes
└── README.md                   # This file
```

## Quick Start

### Prerequisites

- AWS CLI configured with appropriate permissions
- Node.js 18+ and npm
- AWS CDK CLI installed (`npm install -g aws-cdk`)
- jq installed for JSON parsing (`brew install jq` on macOS, `apt-get install jq` on Ubuntu)

### Deploy Infrastructure

```bash
# Use the automated deployment script (recommended)
./deploy.sh

# Or deploy manually
cd cdk-infrastructure
npm install
cdk bootstrap  # First time only
cdk deploy --require-approval never
```

The deployment script automatically:
1. Deploys the CDK infrastructure
2. Creates a Bedrock Knowledge Base with S3 Vectors storage
3. Sets up the data source with Bedrock Data Automation
4. Updates Lambda and EKS configurations with resource IDs

### Clean Up

```bash
# Remove all infrastructure
./cleanup.sh
```

## Key Features

- 🚀 **Serverless Architecture**: Auto-scaling and cost-effective
- 🔒 **Security**: AWS IAM, encryption at rest and in transit
- 💰 **Cost Optimized**: VPC endpoints instead of NAT Gateway (~$7/month vs ~$45/month)
- 📊 **Multi-modal Processing**: PDF and PowerPoint document support
- 🔍 **Vector Search**: Semantic search across document content
- 📈 **Monitoring**: CloudWatch integration for observability

## API Endpoints

Once deployed, the system provides these endpoints:

- `GET /health` - Health check
- `POST /chat` - Send chat messages and receive AI responses
- `POST /feedback` - Submit user feedback for responses
- `GET /documents` - List processed documents

## Configuration

### Environment Variables

- `CDK_DEFAULT_ACCOUNT`: AWS account ID (auto-detected)
- `CDK_DEFAULT_REGION`: AWS region (default: us-west-2)

### AWS Services Configuration

The CDK stack automatically configures:
- IAM roles and policies with least privilege
- S3 buckets with encryption and versioning
- DynamoDB with point-in-time recovery
- CloudWatch log groups with retention policies
- VPC with private subnets and VPC endpoints for cost optimization
- EKS cluster with Fargate profile for containerized agents

## Security Features

- **Encryption**: All data encrypted at rest and in transit
- **IAM**: Least privilege access controls
- **VPC**: Private isolated subnets for backend services
- **API Gateway**: CORS and throttling configured
- **CDK Nag**: Security best practices validation

## Monitoring and Observability

- **CloudWatch Logs**: Centralized logging for all components
- **CloudWatch Metrics**: Performance and usage metrics
- **DynamoDB Insights**: Database performance monitoring

## Development

### Local Development

```bash
# CDK development with hot reload
cd cdk-infrastructure
npm run watch
```

### Testing

```bash
# Run CDK tests
cd cdk-infrastructure
npm test
```

### Debugging

1. Check CloudWatch logs for error messages
2. Verify IAM permissions for all services
3. Test API endpoints directly with curl/Postman
4. Monitor DynamoDB and S3 access patterns

## Troubleshooting

### Common Issues

1. **Documents not processing**: Check S3 event triggers and Lambda logs
2. **Chat API not working**: Verify API Gateway URL and CORS settings
3. **Knowledge Base empty**: Ensure documents are in `processed/` folder
4. **High costs**: Review CloudWatch metrics and optimize resource usage

### EKS Fargate Specific

- Fargate requires private subnets (configured automatically)
- VPC endpoints provide cost-effective connectivity
- Agent pods may take 2-3 minutes to start on first deployment

## Cost Optimization

- **Serverless**: Pay-per-use Lambda and API Gateway
- **S3 Lifecycle**: Automatic data archival policies
- **DynamoDB**: On-demand billing mode
- **EKS Fargate**: No EC2 instance management
- **VPC Endpoints**: Avoid NAT Gateway costs

## Support

For issues and questions:
1. Check the troubleshooting section above
2. Review CloudWatch logs
3. See `DEPLOYMENT.md` for detailed deployment instructions
4. Check `IMPLEMENTATION_NOTES.md` for technical details

## Contributing

1. Make changes to the CDK infrastructure in `cdk-infrastructure/`
2. Test changes with `npm test`
3. Deploy with `./deploy.sh`
4. Update documentation as needed
