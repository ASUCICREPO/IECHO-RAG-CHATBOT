# iECHO RAG Chatbot - Implementation Notes

## Technical Decisions Made

### Architecture Simplification
- **Removed**: Frontend components, authentication, VPC complexity
- **Kept**: ALB requirement for compliance, EKS Fargate for 24/7 availability
- **Optimized**: Eliminated NAT Gateway while maintaining security

### Document Processing Pipeline
- **PPT Conversion**: python-pptx + reportlab for actual conversion (not just renaming)
- **Enhanced Metadata**: Structured document processing for better Bedrock parsing
- **Lambda Layer**: Dedicated layer for document processing dependencies
- **S3 Triggers**: Automatic processing on upload

### AI/ML Implementation
- **Bedrock Data Automation**: Superior parsing vs basic chunking
- **Hierarchical Chunking**: Optimized for document structure
- **Vector Store**: S3-based for scalability
- **Model Selection**: Nova Lite + Titan Multimodal Embedding

### Cost Optimization Strategies
- **NAT Gateway Removal**: ~$45/month savings
- **Public Subnets**: Simplified networking while maintaining ALB
- **Serverless First**: Lambda + API Gateway for variable workloads
- **EKS Fargate**: No EC2 management overhead

## Key Code Implementations

### CDK Stack Structure
```
cdk-infrastructure/
├── lib/iecho-rag-chatbot-stack.ts (main stack)
├── lambda-functions/ (API handlers)
├── lambda-layers/ (document processing)
└── bin/iecho-rag-chatbot.ts (entry point)
```

### API Endpoints Implemented
- `GET /health` - Health check
- `POST /chat` - AI chat with citations
- `POST /feedback` - User feedback collection
- `GET /documents` - List processed documents

### Document Processing Flow
1. Upload to S3 `uploads/` folder
2. Lambda trigger processes document
3. PPT → PDF conversion if needed
4. Move to `processed/` with metadata
5. Bedrock Data Automation parsing
6. Vector indexing in Knowledge Base

## Deployment Configuration
- **Default Region**: us-west-2
- **CDK Bootstrap**: Required for first deployment
- **Environment Variables**: CDK_DEFAULT_ACCOUNT, CDK_DEFAULT_REGION
- **Dependencies**: Node.js 18+, AWS CDK CLI

## Testing Strategy
- Health endpoint verification
- Document upload and processing
- Chat functionality with citations
- Feedback system validation

## Monitoring & Observability
- CloudWatch Logs for all components
- DynamoDB insights enabled
- API Gateway metrics
- Lambda performance monitoring

---
*Implementation completed: July 28, 2025*
*All functionality verified and documented*
