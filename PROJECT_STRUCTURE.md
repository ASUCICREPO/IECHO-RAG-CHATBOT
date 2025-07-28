# iECHO RAG Chatbot - Project Structure

## 📁 Directory Structure

```
iECHO-RAG-CHATBOT/
├── README.md                           # Main project documentation
├── DEPLOYMENT.md                       # Deployment instructions
├── PROJECT_STRUCTURE.md               # This file
├── .gitignore                          # Git ignore rules
├── deploy.sh                           # Main deployment script
├── cleanup.sh                          # Project cleanup script
└── cdk-infrastructure/                 # AWS CDK infrastructure code
    ├── package.json                    # CDK project dependencies
    ├── tsconfig.json                   # TypeScript configuration
    ├── cdk.json                        # CDK configuration
    ├── jest.config.js                  # Jest testing configuration
    ├── build-layer.sh                  # Lambda layer build script
    ├── bin/
    │   └── iecho-rag-chatbot.ts        # CDK app entry point
    ├── lib/
    │   └── iecho-rag-chatbot-stack.ts  # Main CDK stack definition
    ├── test/
    │   └── iecho-rag-chatbot.test.ts   # CDK stack tests
    ├── lambda-functions/
    │   └── document-processor/
    │       └── index.py                # Document processing Lambda
    └── lambda-layers/
        └── document-processing/
            └── requirements.txt        # Python dependencies for layer
```

## 🏗️ Architecture Components

### **API Layer**
- **API Gateway**: Direct HTTP proxy integration to ALB
- **VPC Link**: Private communication to EKS Fargate
- **CORS**: Enabled for all origins and methods

### **Compute Layer**
- **EKS Fargate**: Serverless container execution
- **Strands SDK Agent**: Multi-agent orchestration system
- **Application Load Balancer**: Routes traffic to Fargate tasks
- **Document Processor Lambda**: Handles file conversion (PPT→PDF)

### **AI/ML Layer**
- **Bedrock Knowledge Base**: Vector-based document retrieval
- **Amazon Nova Lite**: Foundation model for response generation
- **Titan Multimodal Embedding**: Document vectorization
- **S3 Vector Store**: Scalable vector storage

### **Storage Layer**
- **S3 Document Bucket**: Stores uploaded and processed documents
- **S3 Vector Store**: Stores vector embeddings
- **DynamoDB**: User feedback and interaction analytics

## 🚀 Deployment Flow

1. **Preparation**: Run `./cleanup.sh` to clean project
2. **Build**: Lambda layer built automatically during deployment
3. **Deploy**: Run `./deploy.sh` to deploy all infrastructure
4. **Configure**: Enable Bedrock models in AWS Console
5. **Test**: Upload documents and test API endpoints

## 🔧 Development Workflow

### **Local Development**
```bash
cd cdk-infrastructure
npm install
npm run watch    # Watch for changes
```

### **Testing**
```bash
cd cdk-infrastructure
npm test         # Run CDK tests
cdk synth        # Synthesize CloudFormation
```

### **Deployment**
```bash
./deploy.sh      # Deploy everything
```

### **Cleanup**
```bash
./cleanup.sh     # Clean project files
cdk destroy      # Remove AWS resources
```

## 📋 File Descriptions

### **Root Level Files**
- `README.md`: Complete project documentation with features and API endpoints
- `DEPLOYMENT.md`: Step-by-step deployment instructions
- `deploy.sh`: Automated deployment script with error handling
- `cleanup.sh`: Removes temporary files and build artifacts
- `.gitignore`: Comprehensive exclusion rules for Git

### **CDK Infrastructure**
- `iecho-rag-chatbot-stack.ts`: Complete AWS infrastructure definition
- `iecho-rag-chatbot.ts`: CDK app entry point with CDK Nag integration
- `package.json`: CDK dependencies and scripts
- `build-layer.sh`: Builds Python Lambda layer with dependencies

### **Lambda Functions**
- `document-processor/index.py`: Actual PPT→PDF conversion implementation
- `requirements.txt`: Python dependencies for document processing

## 🧹 Maintenance

### **Regular Cleanup**
Run `./cleanup.sh` before commits to remove:
- Compiled TypeScript files (*.js, *.d.ts)
- Node modules
- CDK output directory
- Lambda layer build artifacts
- Temporary files

### **Dependencies**
- CDK dependencies managed in `cdk-infrastructure/package.json`
- Python dependencies for Lambda layer in `lambda-layers/document-processing/requirements.txt`
- Lambda function dependencies embedded in code

## 🔒 Security

- **IAM Roles**: Least privilege access for all components
- **VPC**: Private subnets for EKS and ALB
- **Encryption**: At rest and in transit for all data
- **CDK Nag**: Security best practices validation

## 📊 Monitoring

- **CloudWatch Logs**: Centralized logging for all components
- **Health Endpoints**: Built-in health checks for all services
- **DynamoDB**: Stores interaction analytics and feedback

This structure provides a clean, maintainable, and production-ready codebase for the iECHO RAG Chatbot system.
