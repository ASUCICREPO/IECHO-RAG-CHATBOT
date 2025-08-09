# iECHO RAG Chatbot API Documentation

Base URL: `https://your-api-gateway-url`

## Authentication

No authentication required for current version.

## Endpoints

### 1. Health Check

**GET** `/health`

Check if the service is running.

#### Response
```json
{
  "status": "healthy",
  "service": "iECHO RAG Chatbot API",
  "timestamp": "2024-01-15T10:30:00.000Z"
}
```

#### Test Command
```bash
curl https://your-api-gateway-url/health
```

---

### 2. Chat (Streaming)

**POST** `/chat`

Send a query and receive streaming AI response.

#### Request Body
```json
{
  "query": "What are the symptoms of tuberculosis?",
  "userId": "user123",
  "sessionId": "session456" // Optional
}
```

#### Parameters
- `query` (string, required): User's question
- `userId` (string, required): Unique user identifier
- `sessionId` (string, optional): Session ID for conversation continuity

#### Response (NDJSON Stream)

The response is streamed as newline-delimited JSON chunks:

**Content Chunk:**
```json
{"type": "content", "data": "Tuberculosis symptoms include..."}
```

**Citations Chunk:**
```json
{
  "type": "citations",
  "data": [
    {
      "title": "TB Symptoms Overview...",
      "source": "s3://bucket/processed/TB/document.pdf",
      "excerpt": "Common symptoms of TB include persistent cough..."
    }
  ]
}
```

**Completion Chunk:**
```json
{
  "type": "complete",
  "data": {
    "sessionId": "session456",
    "userId": "user123",
    "response": "Complete response text...",
    "citations": [...]
  }
}
```

#### Test Commands

**TB Query:**
```bash
curl -X POST https://your-api-gateway-url/chat \
  -H "Content-Type: application/json" \
  -d '{
    "query": "What are the symptoms of TB?",
    "userId": "test-user"
  }'
```

**Agriculture Query:**
```bash
curl -X POST https://your-api-gateway-url/chat \
  -H "Content-Type: application/json" \
  -d '{
    "query": "How to prevent crop diseases?",
    "userId": "test-user"
  }'
```

**Conversation Continuity:**
```bash
curl -X POST https://your-api-gateway-url/chat \
  -H "Content-Type: application/json" \
  -d '{
    "query": "Tell me more about treatment options",
    "userId": "test-user",
    "sessionId": "session123"
  }'
```

---

### 3. Submit Feedback

**POST** `/feedback`

Submit user feedback for responses.

#### Request Body
```json
{
  "userId": "user123",
  "responseId": "response456",
  "rating": 4,
  "feedback": "Very helpful response"
}
```

#### Parameters
- `userId` (string, required): User identifier
- `responseId` (string, required): ID of the response being rated
- `rating` (integer, required): Rating from 1-5
- `feedback` (string, optional): Additional feedback text

#### Response
```json
{
  "message": "Feedback submitted successfully",
  "feedbackId": "fb-uuid-here"
}
```

#### Test Command
```bash
curl -X POST https://your-api-gateway-url/feedback \
  -H "Content-Type: application/json" \
  -d '{
    "userId": "test-user",
    "responseId": "resp-123",
    "rating": 5,
    "feedback": "Excellent response!"
  }'
```

---

### 4. List Documents

**GET** `/documents`

List processed documents in the knowledge base.

#### Response
```json
{
  "documents": [
    {
      "key": "processed/TB/tuberculosis-guide.pdf",
      "name": "tuberculosis-guide.pdf",
      "size": 1024000,
      "lastModified": "2024-01-15T10:30:00.000Z"
    },
    {
      "key": "processed/agriculture/crop-management.pdf",
      "name": "crop-management.pdf",
      "size": 2048000,
      "lastModified": "2024-01-14T15:20:00.000Z"
    }
  ],
  "count": 2
}
```

#### Test Command
```bash
curl https://your-api-gateway-url/documents
```

---

### 5. System Status

**GET** `/status`

Get system status and configuration.

#### Response
```json
{
  "service": "iECHO RAG Chatbot API",
  "status": "running",
  "knowledgeBaseConfigured": true,
  "documentsConfigured": true,
  "feedbackConfigured": true,
  "region": "us-west-2",
  "timestamp": "2024-01-15T10:30:00.000Z"
}
```

#### Test Command
```bash
curl https://your-api-gateway-url/status
```

---

## Error Responses

All endpoints return standard HTTP error codes with JSON error messages:

#### 400 Bad Request
```json
{
  "detail": "Query cannot be empty"
}
```

#### 500 Internal Server Error
```json
{
  "detail": "Internal server error: specific error message"
}
```

---

## Agent Routing

The orchestration agent automatically routes queries to appropriate specialists:

- **TB Agent**: Tuberculosis, TB treatment, diagnosis, symptoms
- **Agriculture Agent**: Farming, crops, food safety, agricultural practices

### Example Routing

**TB Queries:**
- "What are TB symptoms?"
- "How is tuberculosis treated?"
- "TB prevention methods"

**Agriculture Queries:**
- "How to prevent crop diseases?"
- "Best farming practices"
- "Food safety guidelines"

---

## Streaming Response Handling

### JavaScript Example
```javascript
const response = await fetch('/chat', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    query: 'What are TB symptoms?',
    userId: 'user123'
  })
});

const reader = response.body.getReader();
const decoder = new TextDecoder();

while (true) {
  const { done, value } = await reader.read();
  if (done) break;
  
  const chunk = decoder.decode(value);
  const lines = chunk.split('\n').filter(line => line.trim());
  
  for (const line of lines) {
    const data = JSON.parse(line);
    
    if (data.type === 'content') {
      console.log('Content:', data.data);
    } else if (data.type === 'citations') {
      console.log('Citations:', data.data);
    } else if (data.type === 'complete') {
      console.log('Complete response:', data.data);
    }
  }
}
```

### Python Example
```python
import requests
import json

response = requests.post(
    'https://your-api-gateway-url/chat',
    json={
        'query': 'What are TB symptoms?',
        'userId': 'user123'
    },
    stream=True
)

for line in response.iter_lines():
    if line:
        data = json.loads(line.decode('utf-8'))
        
        if data['type'] == 'content':
            print(f"Content: {data['data']}")
        elif data['type'] == 'citations':
            print(f"Citations: {data['data']}")
        elif data['type'] == 'complete':
            print(f"Complete: {data['data']}")
```

---

## Rate Limits

No rate limits currently implemented. Consider implementing rate limiting for production use.

---

## CORS

CORS is enabled for all origins. Configure appropriately for production:
- `Access-Control-Allow-Origin: *`
- `Access-Control-Allow-Methods: *`
- `Access-Control-Allow-Headers: Content-Type, Authorization`