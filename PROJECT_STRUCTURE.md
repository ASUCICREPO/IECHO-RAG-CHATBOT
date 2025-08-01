# iECHO RAG Chatbot - Project Structure

This document outlines the complete project structure for the iECHO RAG Chatbot system.

## Root Directory Structure

```
iECHO-RAG-CHATBOT/
├── backend/                    # Backend infrastructure and services
│   ├── cdk-infrastructure/     # AWS CDK infrastructure code
│   ├── deploy.sh              # Automated deployment script
│   ├── cleanup.sh             # Infrastructure cleanup script
│   ├── DEPLOYMENT.md          # Backend deployment guide
│   ├── IMPLEMENTATION_NOTES.md # Technical implementation notes
│   └── README.md              # Backend-specific documentation
├── README.md                  # Main project documentation
├── PROJECT_STRUCTURE.md       # This file
├── chat-context.md           # Chat context and conversation history
├── .gitignore                # Git ignore patterns
└── .git/                     # Git repository metadata
```

## Backend Directory (`backend/`)

### CDK Infrastructure (`backend/cdk-infrastructure/`)

```
cdk-infrastructure/
├── bin/
│   └── iecho-rag-chatbot.ts   # CDK app entry point
├── lib/
│   └── iecho-rag-chatbot-stack.ts # Main infrastructure stack
├── test/
│   └── iecho-rag-chatbot.test.ts  # Infrastructure tests
├── lambda/
│   └── document-processor/     # Lambda function code
│       ├── index.py           # Document processing logic
│       ├── requirements.txt   # Python dependencies
│       └── layers/            # Lambda layers
├── kubernetes/
│   └── agent-manifests/       # Kubernetes manifests for EKS
│       ├── namespace.yaml     # Agent namespace
│       ├── configmap.yaml     # Configuration
│       ├── deployment.yaml    # Agent deployment
│       └── service.yaml       # Service definition
├── package.json               # CDK dependencies
├── package-lock.json          # Locked dependencies
├── tsconfig.json             # TypeScript configuration
├── cdk.json                  # CDK configuration
└── jest.config.js            # Test configuration
```

## Key Components

### 1. Infrastructure as Code (CDK)
- **Stack Definition**: Complete AWS infrastructure defined in TypeScript
- **Resource Management**: S3 buckets, Lambda functions, EKS cluster, API Gateway
- **Security**: IAM roles, policies, and security groups
- **Networking**: VPC with private subnets and VPC endpoints

### 2. Serverless Functions
- **Document Processor**: Lambda function for document ingestion and processing
- **API Handlers**: Serverless API endpoints for chat and feedback
- **Event Processing**: S3 event-driven document processing pipeline

### 3. Container Orchestration
- **EKS Fargate**: Serverless Kubernetes for agent containers
- **Agent Deployment**: Always-running Strands SDK agents
- **Service Mesh**: Load balancing and service discovery

### 4. AI/ML Integration
- **Bedrock Knowledge Base**: Vector-based document retrieval
- **Foundation Models**: Amazon Nova Lite for response generation
- **Embedding Models**: Titan Multimodal for document vectorization
- **Data Automation**: Advanced document parsing and structure extraction

### 5. Storage Systems
- **S3 Buckets**: Document storage and vector embeddings
- **DynamoDB**: User feedback and response ratings
- **Vector Store**: S3-based vector storage for cost optimization

### 6. API Layer
- **HTTP API Gateway**: RESTful endpoints with CORS support
- **VPC Link**: Private connectivity to internal services
- **Application Load Balancer**: Load balancing for EKS services

## Deployment Architecture

```
┌─────────────────┐    ┌──────────────────┐    ┌─────────────────┐
│   API Gateway   │────│    VPC Link      │────│       ALB       │
└─────────────────┘    └──────────────────┘    └─────────────────┘
                                                         │
                                                         ▼
┌─────────────────┐    ┌──────────────────┐    ┌─────────────────┐
│   S3 Buckets    │    │   EKS Fargate    │    │   Lambda Fns    │
│  - Documents    │    │  - Agent Pods    │    │  - Doc Processor│
│  - Vectors      │    │  - Strands SDK   │    │  - API Handlers │
└─────────────────┘    └──────────────────┘    └─────────────────┘
                                                         │
                                                         ▼
┌─────────────────┐    ┌──────────────────┐    ┌─────────────────┐
│   DynamoDB      │    │   Bedrock KB     │    │   CloudWatch    │
│  - Feedback     │    │  - Vector Search │    │  - Logs/Metrics │
└─────────────────┘    └──────────────────┘    └─────────────────┘
```

## Development Workflow

### 1. Infrastructure Changes
```bash
cd backend/cdk-infrastructure
npm install
npm run build
npm test
cdk diff
cdk deploy
```

### 2. Lambda Function Updates
```bash
cd backend/cdk-infrastructure/lambda/document-processor
# Edit Python code
# CDK will automatically package and deploy
```

### 3. Kubernetes Manifests
```bash
cd backend/cdk-infrastructure/kubernetes/agent-manifests
# Edit YAML files
# CDK will apply changes to EKS cluster
```

### 4. Full Deployment
```bash
cd backend
./deploy.sh  # Automated deployment
```

### 5. Cleanup
```bash
cd backend
./cleanup.sh  # Remove all resources
```

## Configuration Files

### CDK Configuration (`cdk.json`)
- CDK app settings and feature flags
- Build and deployment configurations

### TypeScript Configuration (`tsconfig.json`)
- Compiler options for CDK code
- Module resolution and type checking

### Package Configuration (`package.json`)
- CDK and development dependencies
- Build and test scripts

## Security Considerations

### 1. IAM Policies
- Least privilege access for all resources
- Service-specific roles and policies
- Cross-service permissions carefully scoped

### 2. Network Security
- Private subnets for backend services
- VPC endpoints for AWS service connectivity
- Security groups with minimal required access

### 3. Data Encryption
- S3 buckets encrypted at rest
- DynamoDB encryption enabled
- API Gateway with TLS termination

### 4. Secrets Management
- No hardcoded credentials in code
- AWS Systems Manager Parameter Store
- Environment-specific configurations

## Monitoring and Observability

### 1. CloudWatch Integration
- Centralized logging for all components
- Custom metrics and dashboards
- Automated alerting and notifications

### 2. Distributed Tracing
- X-Ray integration (optional)
- Request flow tracking
- Performance bottleneck identification

### 3. Health Checks
- API Gateway health endpoints
- EKS pod health monitoring
- Lambda function error tracking

## Future Enhancements

### 1. Frontend Integration
```
iECHO-RAG-CHATBOT/
├── backend/           # Current backend implementation
├── frontend/          # Future web interface
│   ├── web/          # React/Next.js web app
│   └── mobile/       # React Native mobile app
└── shared/           # Shared utilities and types
```

### 2. Additional Services
- Real-time chat with WebSocket support
- Advanced analytics and reporting
- Multi-tenant architecture support
- Enhanced security with WAF and GuardDuty

### 3. CI/CD Pipeline
- GitHub Actions for automated testing
- Multi-environment deployments
- Infrastructure drift detection
- Automated security scanning

This structure provides a solid foundation for the iECHO RAG Chatbot system while maintaining flexibility for future enhancements and scaling requirements.
