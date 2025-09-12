# API Documentation

**Base URL**: The API Gateway URL is dynamically generated during deployment. You can find it in:
- AWS Console → API Gateway → "iECHO Agent API" → Stages → prod
- CDK deployment output: `AgentFargateStack.ApiGatewayUrl`
- Format: `https://{api-id}.execute-api.{region}.amazonaws.com/prod/`

## Architecture

The API uses a multi-agent architecture powered by the Strands framework for educational purposes:
- **Orchestrator Agent**: Analyzes queries and routes to appropriate specialist agents using natural language understanding
- **TB Specialist Agent**: Provides educational information about tuberculosis and health topics with knowledge base integration
- **Agriculture Specialist Agent**: Offers educational content on farming, crops, irrigation, food safety, and water management
- **Image Analysis**: Optional image processing via strands_tools.image_reader for visual content understanding
- **Knowledge Base Integration**: AWS Bedrock Knowledge Base with Amazon Nova Lite model (us.amazon.nova-lite-v1:0), Amazon Titan 
Text Embeddings G1 - Text and hierarchical chunking

**Important**: This is an educational tool and should not be used for medical diagnosis or treatment decisions.

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

Educational chat endpoint with multi-agent orchestration for TB and Agriculture topics.

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
- `query` (string, required): User's educational question - automatically routed to TB or Agriculture specialists
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
{"type": "thinking_start"}
{"type": "thinking", "data": "Let me analyze this irrigation question..."}
{"type": "thinking_end"}
{"type": "content", "data": "Improving"}
{"type": "content", "data": " irrigation"}
{"type": "error", "data": "Request timeout. Please try again."}
{"response": "Complete response text", "citations": [...], "sessionId": "...", "responseId": "...", "userId": "...", "followUpQuestions": [...]}
```

**Event Types:**
- `thinking_start`: Indicates the agent is beginning to reason about the query
- `thinking`: Contains reasoning text (can be hidden from users)
- `thinking_end`: Indicates reasoning phase is complete
- `content`: Individual content chunks for the final response
- `error`: Error message if something goes wrong
- Final JSON object: Complete response with metadata, citations, and follow-up questions

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
      "name": "tb-guidelines-2024.pdf",
      "lastModified": "2025-01-15T10:00:00Z",
      "size": 1024000
    }
  ],
  "count": 1
}
```

### GET /document-url/{path}

Generate presigned URL for document access.

**Parameters:**
- `path` (string, required): Document path from `/documents` response

**Response:**
```json
{
  "url": "https://s3.amazonaws.com/bucket/document.pdf?presigned-params"
}
```

### GET /status

System status with configuration details.

**Response:**
```json
{
  "service": "iECHO RAG Chatbot API",
  "status": "running",
  "knowledgeBaseConfigured": true,
  "documentsConfigured": true,
  "feedbackConfigured": true,
  "region": "us-west-2",
  "timestamp": "2025-01-15T10:04:44.810349"
}
```

## Request Validation

- **Query Length**: Maximum 150 tokens per query
- **Image Size**: Maximum 5MB for base64-encoded images  
- **Rating Range**: 1-5 stars for feedback submissions
- **Empty Queries**: Not allowed - queries must contain text
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
- **Empty Query**: `400 - Query cannot be empty`
- **Query Too Long**: `400 - Query too long. X tokens provided, maximum 150 tokens allowed`
- **Image Too Large**: `413 - Image too large. Maximum size is 5MB`
- **Knowledge Base Not Configured**: `500 - Knowledge Base not configured`
- **Invalid S3 URL**: `400 - Invalid S3 URL format`
- **No Data Sources**: `500 - No data sources found in Knowledge Base`
- **Request Timeout**: Stream error event with "Request timeout. Please try again."

## Agent Routing Logic

The orchestrator automatically routes queries based on content analysis:

### TB Specialist Agent
**Triggers:**
- Medical terminology (symptoms, diagnosis, treatment)
- TB-specific terms (tuberculosis, MDR, XDR, DOTS)
- Health-related questions

**Capabilities:**
- TB diagnosis & symptoms analysis
- Treatment protocols & medications (HRZE, MDR/XDR management)
- Infection control & prevention strategies
- Patient care guidelines & counseling
- Lab test interpretation (smear, GeneXpert, imaging)

### Agriculture Specialist Agent
**Triggers:**
- Farming terminology (crops, soil, irrigation)
- Agricultural practices and techniques
- Food safety and nutrition questions

**Capabilities:**
- Crop & soil management, irrigation, fertigation
- Integrated Pest Management (IPM) & yield optimization
- Food safety & nutrition, post-harvest handling
- Practical farm best practices & infrastructure

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
5. Appropriate specialist agent selected (TB or Agriculture)
6. Response generated with image context

### Use Cases
- Images for TB-related educational analysis
- Image for agricultural related educational analysis
- Visual documentation analysis

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
