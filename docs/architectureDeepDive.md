# Architecture Deep Dive

## Architecture Overview
![Architecture Diagram](./media/architecture.png)

The iECHO RAG Chatbot implements a sophisticated multi-domain conversational AI system using AWS cloud services. Does intelligent query routing, vector-based knowledge retrieval, and real-time response streaming.

## Request Flow

1. **User Query**: User submits questions and optional images through the Next.js web interface hosted on AWS Amplify.
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

### Frontend Layer
- **AWS Amplify**: 
  - Hosts Next.js web application with static site generation
  - Manual deployment via zip upload (no GitHub integration)
  - Automatic HTTPS and CDN distribution
  - Environment variable management for API endpoints

### API Layer
- **API Gateway**: 
  - REST API with CORS configuration
  - Routes all requests to Application Load Balancer
  - Request/response logging to CloudWatch

### Compute Layer
- **EKS Fargate**: 
  - **Multi-Agent FastAPI Application**: Python application in `docker/app/` using Strands framework for intelligent query routing
  - **Deployment**: 2 replicas with resource limits (500m CPU request, 1000m CPU limit, 512Mi memory request, 1Gi memory limit)
  - **Health Monitoring**: Liveness probes (30s initial delay, 10s period) and readiness probes (5s initial delay, 5s period)
  - **Image Support**: Integrated strands_tools.image_reader for processing uploaded images alongside text queries
  - **Kubernetes Version**: v1.32 with Fargate profiles for serverless container execution
  - **Networking**: Private subnets with NAT Gateway for outbound internet access

- **Application Load Balancer**: 
  - Distributes incoming requests across EKS pods
  - Health checks on `/health` endpoint
  - Integration with AWS Load Balancer Controller v1.8.0
  - Target group configuration for Fargate services

### AI Layer
- **AWS Bedrock Knowledge Base**: 
  - **Vector Store Type**: S3 vector store
  - **Embedding Model**: Amazon Titan Text Embeddings G1 - Text for semantic search
  - **Chunking Strategy**: Hierarchial chunking for optimal document segmentation
  - **Data Source**: Connected to S3 documents bucket with automatic synchronization
  - **LLM Integration**: Powers multi-agent reasoning using Amazon Nova Lite inference profile (us.amazon.nova-lite-v1:0)
  - **Multi-Domain Content**: Specialized knowledge for TB and Agriculture

### Storage Layer
- **S3 Storage**: 
  - **Documents Bucket**: Stores processed documents (PDF, DOCX, TXT, MD) for Knowledge Base ingestion
  - **Vector Store Bucket**: Houses vector index

- **DynamoDB**: 
  - Pay-per-request NoSQL database for user feedback storage

### Processing Layer
- **Lambda Functions** (Optional):
  - **office-to-pdf**: Converts DOCX, XLSX, PPTX files to PDF format
  - **Event-driven**: Triggered by S3 uploads for automatic document processing
  - **Runtime**: Python 3.12 with LibreOffice for document conversion

### Monitoring & Logging
- **CloudWatch**: 
  - **Application Logs**: `/aws/containerinsights/{cluster-name}/application` with infinite retention
  - **EKS Cluster Logs**: API, Audit, Authenticator, Controller Manager, and Scheduler logging
  - **CodeBuild Logs**: `/aws/codebuild/{project-name}` for deployment monitoring
  - **Lambda Logs**: `/aws/lambda/{function-name}` for document processing
  - **API Gateway Logs**: `API-Gateway-Execution-Logs_{api-id}/prod` for request tracking

### Networking & Security
- **VPC Configuration**:
  - **Multi-AZ**: 2 Availability Zones for high availability
  - **Subnets**: Public subnets for ALB, private subnets for EKS
  - **NAT Gateway**: Single NAT Gateway for cost optimization
  - **Internet Gateway**: For public subnet internet access

- **Security Groups**:
  - **ALB Security Group**: HTTP/HTTPS inbound from internet
  - **EKS Security Group**: HTTP inbound from ALB only
  - **VPC Endpoints Security Group**: HTTPS for AWS service communication

- **IAM Roles & Policies**:
  - **EKS Cluster Role**: Manages EKS cluster operations
  - **Fargate Profile Role**: Executes pods on Fargate
  - **Application Role**: Accesses Bedrock, DynamoDB, and CloudWatch
  - **CodeBuild Role**: Least-privilege permissions for deployment
  - **Amplify Role**: Frontend deployment and hosting

- **VPC Endpoints**:
  - **Gateway Endpoints**: S3 and DynamoDB for cost optimization
  - **Interface Endpoints**: ECR, CloudWatch, Bedrock, STS, EKS, EC2, Lambda for secure communication

## Deployment Architecture

### Infrastructure as Code
- **AWS CDK**: TypeScript-based infrastructure definition
- **CDK8s**: Kubernetes manifests generated from CDK
- **Stack Management**: Single CloudFormation stack (AgentFargateStack)
- **Resource Tagging**: Consistent tagging for cost allocation and management

### CI/CD Pipeline
- **CodeBuild Projects**:
  - **Backend**: `buildspec.yml` for CDK deployment
  - **Frontend**: `buildspec-frontend.yml` for Amplify deployment
  - **IAM Roles**: Least-privilege permissions for each build process
  - **Artifact Storage**: Temporary S3 buckets for source code

- **Deployment Process**:
  1. **Source Packaging**: Create zip archive of source code
  2. **Backend Deployment**: CDK synthesize and deploy infrastructure
  3. **Frontend Deployment**: Next.js build and Amplify zip upload
  4. **Verification**: Health checks and smoke tests
  5. **Cleanup**: Remove temporary resources

### Security Best Practices
- **Least Privilege Access**: IAM roles with minimal required permissions
- **Network Isolation**: Private subnets for compute resources
- **Encryption**: At-rest and in-transit encryption for all data
- **Secrets Management**: Environment variables for sensitive configuration
- **Resource Isolation**: Dedicated VPC with controlled access

### Monitoring & Observability
- **CloudWatch Metrics**: Custom metrics for application performance
- **Log Aggregation**: Centralized logging across all services
- **Health Checks**: Comprehensive health monitoring at all layers
- **Alerting**: CloudWatch alarms for critical system events

## Cost Optimization

### Resource Efficiency
- **Fargate**: Pay-per-use compute without managing servers
- **DynamoDB**: Pay-per-request pricing for variable usage
- **VPC Endpoints**: Reduce NAT Gateway data transfer costs

### Operational Efficiency
- **Managed Services**: Reduce operational overhead with AWS managed services
- **Automated Deployment**: Reduce manual deployment time and errors
- **Infrastructure as Code**: Version-controlled, repeatable deployments
- **Monitoring**: Proactive issue detection and resolution
