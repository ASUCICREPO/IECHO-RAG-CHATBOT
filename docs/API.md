# iECHO RAG Chatbot API Documentation

Base URL: `https://your-api-gateway-url/`

## Architecture

The API uses a multi-agent architecture:
- **Orchestrator Agent**: Routes queries to specialized domain agents
- **TB Agent**: Handles tuberculosis-related questions
- **Agriculture Agent**: Handles agriculture, farming, food safety, and water management

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
  "sessionId": "session-456"
}
```

**Parameters:**
- `query` (string, required): User's question - automatically routed to TB or Agriculture agents
- `userId` (string, required): User identifier
- `sessionId` (string, optional): Session ID (auto-generated if not provided)

**Response:**
Complete JSON response with citations:

```json
{
  "response": "The main symptoms of tuberculosis (TB) include: A persistent cough lasting more than two weeks, fever, significant weight loss, haemoptysis (blood in sputum), and any abnormality in chest radiograph...",
  "citations": [
    {
      "title": "# Common signs and symptoms of TB Common signs and symptoms of TB include cough for more than two we...",
      "source": "s3://s3-iecho/processed/Unit 2 TB Epidemiology and Diagnosis.pdf",
      "excerpt": "# Common signs and symptoms of TB Common signs and symptoms of TB include cough for more than two weeks, fever, significant weight loss, haemoptysis (blood in sputum) and any abnormality in chest radi..."
    }
  ],
  "sessionId": "session-456",
  "responseId": "1c57393c-8bab-44bb-adce-a81c8c1240f2",
  "userId": "test-user-123"
}
```

**Performance:**
- **TB queries**: ~5.4 seconds
- **Agriculture queries**: ~7.5 seconds
- **Error responses**: ~0.5 seconds

**Features:**
- Unified multi-agent orchestration (same as streaming)
- Intelligent domain routing (TB/Agriculture)
- API Gateway compatible
- Complete response with comprehensive citations

### POST /chat-stream

Streaming chat endpoint with intelligent agent routing and real-time response generation.

**Request Body:**
```json
{
  "query": "What are the symptoms of TB?",
  "userId": "test-user",
  "sessionId": "optional-session-id"
}
```

**Parameters:**
- `query` (string, required): User's question - automatically routed to TB or Agriculture agents
- `userId` (string, required): User identifier for session management
- `sessionId` (string, optional): Session ID for conversation context (auto-generated if not provided)

**Response:**
Streaming NDJSON response with word-by-word real-time content chunks followed by final response:

```json
{"type": "content", "data": "To"}
{"type": "content", "data": " improve"}
{"type": "content", "data": " irrigation"}
{"type": "content", "data": " efficiency"}
{"type": "content", "data": " in"}
{"type": "content", "data": " your"}
{"type": "content", "data": " farm"}
{"type": "content", "data": ","}
{"type": "content", "data": " consider"}
...
{
  "response": "To improve irrigation efficiency in your farm, consider the following steps: 1. Conduct regular leak audits to identify and repair leaks in your irrigation system...",
  "citations": [
    {
      "title": "Sustainability depends on both supply-side and demand-side measures: **Aquifer Recharge: 1.4.6.1.** ...",
      "source": "s3://s3-iecho/processed/Session 6.pdf",
      "excerpt": "Sustainability depends on both supply-side and demand-side measures: **Aquifer Recharge: 1.4.6.1.** - Rooftop harvesting to recharge pits and wells..."
    }
  ],
  "sessionId": "session-789",
  "responseId": "7e9e80a3-c0b9-4a5a-be3d-c0edbdcf5fdb",
  "userId": "farmer-456"
}
```

**Content-Type:** `application/x-ndjson`

**Performance:**
- **Simple queries**: 3.6-4.4 seconds
- **Complex queries**: 4.7-6.1 seconds
- **Concurrent requests**: 5.4 seconds (no degradation)
- **Immediate response start**: Word-by-word streaming

**Features:**
- Word-by-word real-time streaming with immediate feedback
- Unified multi-agent orchestration (TB and Agriculture specialists)
- Conversation context maintained per session (1-hour TTL)
- Intelligent domain routing with high accuracy
- Comprehensive source citations from knowledge base
- Excellent concurrent performance under load
- Works through API Gateway (buffered streaming)

### POST /feedback

Submit user feedback for responses.

**Request Body:**
```json
{
  "userId": "test-user",
  "responseId": "session-123",
  "rating": 5,
  "feedback": "Great response about TB symptoms!"
}
```

**Parameters:**
- `userId` (string, required): User identifier
- `responseId` (string, required): Unique response ID from chat response (not sessionId)
- `rating` (integer, required): Rating from 1-5
- `feedback` (string, optional): Text feedback

**Response:**
```json
{
  "message": "Feedback submitted successfully",
  "feedbackId": "ce947db3-3229-4648-8e97-5ef1f3df3548"
}
```

### GET /documents

List processed documents in the knowledge base. Dynamically discovers S3 bucket from Bedrock Knowledge Base configuration.

**Response:**
```json
{
  "documents": [
    {
      "key": "processed/TB/Unit 2 TB Epidemiology and Diagnosis.pdf",
      "name": "Unit 2 TB Epidemiology and Diagnosis.pdf",
      "size": 1024000,
      "lastModified": "2025-01-15T10:00:00.000Z"
    },
    {
      "key": "processed/agriculture/Water Management Guide.pdf",
      "name": "Water Management Guide.pdf",
      "size": 2048000,
      "lastModified": "2025-01-15T09:30:00.000Z"
    }
  ],
  "count": 2
}
```

**Features:**
- Automatically discovers S3 bucket from Knowledge Base data sources
- Lists all documents in the `processed/` folder
- Returns document metadata including size and modification date
- Limited to 100 documents per request

### GET /status

Get system status and configuration information.

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

**Status Indicators:**
- `knowledgeBaseConfigured`: Whether KNOWLEDGE_BASE_ID is set
- `documentsConfigured`: Whether document access is available
- `feedbackConfigured`: Whether DynamoDB feedback table is configured

## Error Responses

All endpoints return standard HTTP status codes:

- `200`: Success
- `400`: Bad Request (invalid parameters)
- `500`: Internal Server Error

**Error Format:**
```json
{
  "detail": "Error message description"
}
```

## Examples

### Fast Chat (Non-streaming) - TB Query
```bash
curl -X POST https://your-api-gateway-url/chat \
  -H "Content-Type: application/json" \
  -d '{
    "query": "What are the main symptoms of tuberculosis?",
    "userId": "test-user-123",
    "sessionId": "session-456"
  }'
# Response time: ~5.4 seconds
```

### Streaming Chat - Agriculture Query
```bash
curl -X POST https://your-api-gateway-url/chat-stream \
  -H "Content-Type: application/json" \
  -d '{
    "query": "How can I improve irrigation efficiency in my farm?",
    "userId": "farmer-456",
    "sessionId": "session-789"
  }'
# Response time: ~6.1 seconds with real-time streaming
```

### Mixed Domain Query - Nutrition and TB
```bash
curl -X POST https://your-api-gateway-url/chat-stream \
  -H "Content-Type: application/json" \
  -d '{
    "query": "How does nutrition affect TB treatment outcomes?",
    "userId": "researcher-101",
    "sessionId": "research-session"
  }'
# Response time: ~5.4 seconds
```

### Submit Positive Feedback
```bash
curl -X POST https://your-api-gateway-url/feedback \
  -H "Content-Type: application/json" \
  -d '{
    "userId": "user123",
    "responseId": "unique-response-uuid",
    "rating": 5,
    "feedback": "Very helpful information about TB symptoms!"
  }'
```

### List Available Documents
```bash
curl https://your-api-gateway-url/documents
```

### Check System Status
```bash
curl https://your-api-gateway-url/status
```

### Check System Health
```bash
curl https://your-api-gateway-url/health
```

## Rate Limits

No rate limits currently implemented.

## Technical Details

### CORS Configuration

CORS is enabled at both API Gateway and application levels:
- **Origins**: All origins (`*`) - supports local development
- **Methods**: All HTTP methods
- **Headers**: `Content-Type`, `X-Amz-Date`, `Authorization`, `X-Api-Key`
- **Credentials**: Supported

### Session Management

- Sessions automatically expire after 1 hour of inactivity
- Conversation history maintained for context (last 4 exchanges)
- Session cleanup runs automatically to prevent memory leaks
- UUIDs generated for session IDs if not provided

### Infrastructure

- **Deployment**: EKS Fargate with API Gateway frontend
- **Load Balancing**: Application Load Balancer with health checks
- **Scaling**: Auto-scaling based on demand
- **Monitoring**: CloudWatch logs and metrics
- **Storage**: DynamoDB for feedback, S3 for documents

### AI Models

- **Primary Model**: Amazon Nova Lite v1.0
- **Knowledge Base**: AWS Bedrock with vector search
- **Embedding**: Amazon Titan or configured model
- **Agent Framework**: Strands for multi-agent orchestration
- **Streaming**: Real-time response generation (buffered through API Gateway)

### Endpoint Comparison

| Feature | `/chat` | `/chat-stream` |
|---------|---------|----------------|
| **Response Time** | 5.4-7.5 seconds | 3.6-6.1 seconds |
| **Response Type** | Complete JSON | Streaming NDJSON |
| **Agent Routing** | ✅ Unified multi-agent | ✅ Unified multi-agent |
| **Streaming** | No | Word-by-word real-time |
| **User Experience** | Complete response at once | Immediate feedback, progressive |
| **Concurrent Performance** | Good | Excellent (5.4s under load) |
| **Use Case** | API integrations, mobile | Interactive chat, web apps |
| **API Gateway** | ✅ Optimized | ✅ Compatible (buffered) |