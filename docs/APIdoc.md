# API Documentation

**Base URL**: The API Gateway URL is dynamically generated during deployment. You can find it in:
- AWS Console → API Gateway → "iECHO Agent API" → Stages → prod
- CDK deployment output: `AgentFargateStack.ApiGatewayUrl`
- Format: `https://{api-id}.execute-api.{region}.amazonaws.com/prod/`

## Architecture

The API uses a multi-agent architecture powered by the Strands framework:
- **Orchestrator Agent**: Analyzes queries and routes to appropriate specialist agents using natural language understanding
- **TB Specialist Agent**: Handles tuberculosis and health-related questions with knowledge base integration
- **Agriculture Specialist Agent**: Manages farming, crops, irrigation, food safety, and water management queries
- **Image Analysis**: Optional image processing via strands_tools.image_reader for visual content understanding
- **Knowledge Base Integration**: AWS Bedrock Knowledge Base with Titan G1 Multimodal embeddings and hierarchical chunking

## Authentication

No authentication required for current endpoints.

## Endpoints

### GET /health

Health check endpoint for load balancer monitoring.

**Response:**
```json
{
  "status": "healthy",
  "service": "iECHO RAG Chatbot API",
  "timestamp": "2025-01-15T10:04:44.810349"
}
```

### POST /chat

Fast non-streaming chat endpoint with unified multi-agent orchestration.

**Request Body:**
```json
{
  "query": "What are the main symptoms of tuberculosis?",
  "userId": "test-user-123",
  "sessionId": "session-456",
  "image": "base64-encoded-image-data"
}
```

**Parameters:**
- `query` (string, required): User's question - automatically routed to TB, Agriculture, or General agents
- `userId` (string, required): User identifier for logging and feedback tracking
- `sessionId` (string, optional): Session ID for conversation continuity (auto-generated if not provided)
- `image` (string, optional): Base64-encoded image data for visual analysis

**Response:**
```json
{
  "response": "The main symptoms of tuberculosis include persistent cough lasting more than 2-3 weeks, chest pain, coughing up blood or sputum, weakness or fatigue, weight loss, chills, fever, and night sweats.",
  "responseId": "uuid-for-feedback-tracking",
  "citations": [
    {
      "title": "TB Guidelines 2024",
      "source": "s3://bucket/tb-guidelines.pdf"
    }
  ],
  "followUpQuestions": [
    "How is TB diagnosed?",
    "What are the treatment options for TB?",
    "Is TB contagious?"
  ],
  "sessionId": "session-456",
  "userId": "test-user-123"
}
```

### POST /chat-stream

Streaming chat endpoint with real-time response generation via Server-Sent Events (SSE).

**Request Body:**
```json
{
  "query": "How can I improve irrigation efficiency in my farm?",
  "userId": "farmer-456",
  "sessionId": "session-789",
  "image": "base64-encoded-image-data"
}
```

**Parameters:**
- Same as `/chat` endpoint

**Response:**
Server-Sent Events stream with the following event types:

```
data: {"type": "start", "sessionId": "session-789"}

data: {"type": "token", "data": "Improving"}

data: {"type": "token", "data": " irrigation"}

data: {"type": "token", "data": " efficiency"}

data: {"type": "complete", "responseId": "uuid", "citations": [...], "followUpQuestions": [...]}
```

**Event Types:**
- `start`: Stream initialization with session ID
- `token`: Individual word/token in the response
- `complete`: Final event with metadata, citations, and follow-up questions

### POST /feedback

Submit user feedback for response quality improvement.

**Request Body:**
```json
{
  "userId": "test-user-123",
  "responseId": "response-uuid-from-chat",
  "rating": 5,
  "feedback": "Very helpful and accurate information!"
}
```

**Parameters:**
- `userId` (string, required): User identifier
- `responseId` (string, required): Response ID from chat response
- `rating` (integer, required): Rating from 1-5 stars
- `feedback` (string, optional): Additional comments

**Response:**
```json
{
  "message": "Feedback submitted successfully",
  "feedbackId": "feedback-uuid"
}
```

### GET /documents

List processed documents available in the knowledge base.

**Response:**
```json
{
  "documents": [
    {
      "key": "processed/tb-guidelines-2024.pdf",
      "lastModified": "2025-01-15T10:00:00Z",
      "size": 1024000
    }
  ]
}
```

### GET /document-url/{path}

Generate presigned URL for document access.

**Parameters:**
- `path` (string, required): Document path from `/documents` response

**Response:**
```json
{
  "url": "https://s3.amazonaws.com/bucket/document.pdf?presigned-params",
  "expiresIn": 3600
}
```

### GET /status

System status with configuration details.

**Response:**
```json
{
  "status": "operational",
  "knowledgeBaseId": "KB123456789",
  "region": "us-west-2",
  "version": "1.0.0",
  "agents": {
    "tb": "active",
    "agriculture": "active",
    "orchestrator": "active"
  }
}
```

## Request Limits

- **Query Length**: Maximum 150 tokens per query
- **Image Size**: Maximum 5MB for base64-encoded images
- **Rating Range**: 1-5 stars for feedback submissions
- **Empty Queries**: Not allowed - queries must contain text

## Response Limits

- **Timeout**: 25 seconds maximum for streaming responses
- **Session Duration**: 1 hour automatic expiration

## Error Handling

### Error Response Format
```json
{
  "error": "Error description",
  "code": "ERROR_CODE",
  "timestamp": "2025-01-15T10:04:44.810Z"
}
```

### Common Error Codes
- `INVALID_REQUEST`: Malformed request body
- `KNOWLEDGE_BASE_ERROR`: Knowledge base access issues
- `AGENT_TIMEOUT`: Response generation timeout
- `IMAGE_PROCESSING_ERROR`: Image analysis failure
- `RATE_LIMIT_EXCEEDED`: Too many requests

## Agent Routing Logic

The orchestrator automatically routes queries based on content analysis:

### TB Specialist Agent
**Triggers:**
- Medical terminology (symptoms, diagnosis, treatment)
- TB-specific terms (tuberculosis, MDR, XDR, DOTS)
- Health-related questions

**Capabilities:**
- TB diagnosis and symptoms analysis
- Treatment protocols and medications
- Infection control and prevention
- Patient care guidelines
- Lab test interpretation (smear, GeneXpert)

### Agriculture Specialist Agent
**Triggers:**
- Farming terminology (crops, soil, irrigation)
- Agricultural practices and techniques
- Food safety and nutrition questions

**Capabilities:**
- Crop and soil management
- Irrigation and fertigation advice
- Integrated Pest Management (IPM)
- Yield optimization strategies
- Post-harvest handling
- Food safety guidelines

### General Agent
**Triggers:**
- General health and education topics
- Questions outside TB and agriculture domains

**Capabilities:**
- General health information
- Educational content
- Nutrition guidance
- Wellness advice

## Image Analysis

### Supported Formats
- JPEG (.jpg, .jpeg)
- PNG (.png)
- GIF (.gif)
- WebP (.webp)

### Processing Flow
1. Image uploaded as base64 data
2. Temporary file created for analysis
3. strands_tools.image_reader processes visual content
4. Analysis results combined with text query
5. Appropriate specialist agent selected
6. Response generated with image context

### Use Cases
- Medical images for TB-related analysis
- Crop photos for agricultural diagnosis
- General health and nutrition images
- Visual documentation analysis

## Rate Limiting

- **Per User**: 100 requests per hour
- **Per Session**: 50 requests per session
- **Global**: 1000 requests per minute

## Monitoring and Logging

All API interactions are logged to CloudWatch with:
- Request/response details
- Agent selection reasoning
- Performance metrics
- Error tracking
- User feedback correlation

**Log Groups:**
- `/aws/eks/{cluster-name}/agent-service`: Application logs
- `/aws/eks/{cluster-name}/fargate`: Container logs
- `/aws/eks/{cluster-name}/cluster`: EKS cluster logs
