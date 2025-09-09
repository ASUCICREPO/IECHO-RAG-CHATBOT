# Architecture Deep Dive

## Architecture
![Architecture Diagram](./media/architecture.png)

1. **User Query**: User submits questions and optional images through the React web interface hosted on AWS Amplify.
2. **API Gateway**: Routes requests to the backend API with CORS support and security controls.
3. **Load Balancer**: AWS Application Load Balancer distributes traffic across EKS Fargate pods.
4. **Multi-Agent Orchestrator**: Strands framework analyzes queries and routes to appropriate specialist agents (TB, Agriculture, General).
5. **Image Processing**: Optional image analysis via strands_tools.image_reader for visual content understanding.
6. **Knowledge Base Query**: Selected agent queries AWS Bedrock Knowledge Base using vector search for relevant information.
7. **Response Generation**: Agent generates contextual responses with citations using retrieved knowledge and LLM reasoning.
8. **Streaming Response**: Real-time response streaming back to user via Server-Sent Events (SSE).
9. **Feedback Collection**: Users can rate responses, stored in DynamoDB for continuous improvement.
10. **Session Management**: In-memory conversation history maintained with 1-hour TTL for context continuity.
11. **Monitoring**: All interactions logged to CloudWatch for observability and performance tracking.

## AWS Cloud Services

- **API Gateway**: Acts as the front door for all chat requests, handles CORS and routing to the EKS cluster.
- **EKS Fargate**: 
  - **Multi-Agent FastAPI Application**: Python application using Strands framework for intelligent query routing
  - **Deployment**: 2 replicas with resource limits (500m CPU request, 1000m CPU limit, 512Mi memory request, 1Gi memory limit)
  - **Health Monitoring**: Liveness probes (30s initial delay, 10s period) and readiness probes (5s initial delay, 5s period)
  - **Image Support**: Integrated strands_tools.image_reader for processing uploaded images alongside text queries
- **Application Load Balancer**: Distributes incoming requests across EKS pods with health checks on `/health` endpoint.
- **AWS Bedrock Knowledge Base**: 
  - **Vector Store Type**: Amazon S3-backed vector database for semantic search
  - **Embedding Model**: Amazon Titan Text Embeddings G1 - Multimodal for text and image processing
  - **Chunking Strategy**: Hierarchical chunking for optimal document segmentation and retrieval
  - **Data Source**: Connected to S3 documents bucket with automatic data synchronization
  - **Vector Index**: Stored in dedicated S3 vector store bucket for fast similarity search
  - **LLM Integration**: Powers the multi-agent reasoning and response generation using Nova Lite v1:0 model
- **S3 Storage**: 
  - **Documents Bucket**: Stores processed documents (PDF, DOCX, XLSX, PPTX) for Knowledge Base ingestion
  - **Vector Store Bucket**: Houses the vector index with embeddings for semantic search operations
  - **Data Automation**: Automatic synchronization between document uploads and Knowledge Base updates
- **DynamoDB**: Pay-per-request NoSQL database storing user feedback with TTL for automatic cleanup.
- **CloudWatch**: 
  - **Application Logs**: `/aws/eks/{cluster-name}/agent-service` with infinite retention
  - **Fargate Logs**: `/aws/eks/{cluster-name}/fargate` for container-level logging
  - **EKS Cluster Logs**: API, Audit, Authenticator, Controller Manager, and Scheduler logging enabled
- **Amplify Hosting**: Hosts the React frontend application with GitHub integration for CI/CD.
- **Lambda Functions** (Optional):
  - **office-to-pdf**: Converts DOCX, XLSX, PPTX files to PDF format for Knowledge Base processing
- **VPC Endpoints**: Gateway endpoints for S3 and DynamoDB, interface endpoints for ECR, CloudWatch, Bedrock, STS, EKS, EC2, and Lambda for cost optimization and security.

## AWS CDK and Deployment Information

- **AWS CDK** is used to build the entire infrastructure stack, including EKS Fargate cluster, VPC with 2 AZs and 1 NAT Gateway, API Gateway, DynamoDB, and all required IAM roles and policies. The stack is defined in TypeScript using CDK8s for Kubernetes manifests.
- The **deploy.sh** script automates the deployment process through AWS CodeBuild, which:
  - Creates a CodeBuild project with administrator access service role
  - Stores GitHub access tokens securely in AWS Secrets Manager
  - Builds and deploys the CDK stack with context parameters (Knowledge Base ID, GitHub details, optional documents bucket)
  - Triggers Amplify frontend deployment automatically
- **CodeBuild Integration**: The buildspec.yml defines the build process that installs Node.js 20, CDK CLI, compiles TypeScript, bootstraps CDK, and deploys infrastructure. It also supports destroy mode with automatic Kubernetes security group cleanup.
- **GitHub Integration**: Amplify automatically builds and deploys the frontend when changes are pushed to the `full-cdk` branch.
- **Fargate Profile**: Configured for the `default` namespace with `app: agent-service` selector, running on private subnets with egress.
- **Docker Image**: Application containerized with Python 3.12, FastAPI, and Strands framework, built and pushed to ECR during deployment.
- **Knowledge Base Setup**: Requires manual creation of Bedrock Knowledge Base with S3 vector store configuration and data source synchronization before deployment.
