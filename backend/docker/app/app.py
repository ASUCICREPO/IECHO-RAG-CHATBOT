from typing import List, Dict, Optional
from uuid import uuid4
import os
import json
import boto3
from datetime import datetime

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import PlainTextResponse
from pydantic import BaseModel
import uvicorn

app = FastAPI(title="iECHO RAG Chatbot API")

# Add CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Initialize AWS clients
bedrock_agent_runtime = boto3.client('bedrock-agent-runtime', region_name=os.environ.get('AWS_REGION', 'us-west-2'))
dynamodb = boto3.resource('dynamodb', region_name=os.environ.get('AWS_REGION', 'us-west-2'))
s3 = boto3.client('s3', region_name=os.environ.get('AWS_REGION', 'us-west-2'))

# Environment variables
KNOWLEDGE_BASE_ID = os.environ.get('KNOWLEDGE_BASE_ID', '')
FEEDBACK_TABLE_NAME = os.environ.get('FEEDBACK_TABLE_NAME', 'iecho-feedback-table')
DOCUMENTS_BUCKET = os.environ.get('DOCUMENTS_BUCKET', '')
AWS_ACCOUNT_ID = os.environ.get('AWS_ACCOUNT_ID', '')

# Pydantic models
class ChatRequest(BaseModel):
    query: str
    userId: str
    sessionId: Optional[str] = None

class FeedbackRequest(BaseModel):
    userId: str
    responseId: str
    rating: int
    feedback: Optional[str] = None

class Citation(BaseModel):
    title: str
    source: str
    excerpt: str

class ChatResponse(BaseModel):
    response: str
    sessionId: str
    citations: List[Citation]
    userId: str

@app.get('/health')
def health_check():
    """Health check endpoint for the load balancer."""
    return {
        "status": "healthy",
        "service": "iECHO RAG Chatbot API",
        "timestamp": datetime.utcnow().isoformat()
    }

@app.post('/chat', response_model=ChatResponse)
async def chat(request: ChatRequest):
    """Send a chat message and receive AI-generated response."""
    try:
        if not request.query.strip():
            raise HTTPException(status_code=400, detail="Query cannot be empty")
        
        if not KNOWLEDGE_BASE_ID:
            raise HTTPException(status_code=500, detail="Knowledge Base not configured")
        
        # Generate session ID if not provided
        session_id = request.sessionId or str(uuid4())
        
        # Query the Bedrock Knowledge Base with Nova Lite inference profile
        response = bedrock_agent_runtime.retrieve_and_generate(
            input={
                'text': request.query
            },
            retrieveAndGenerateConfiguration={
                'type': 'KNOWLEDGE_BASE',
                'knowledgeBaseConfiguration': {
                    'knowledgeBaseId': KNOWLEDGE_BASE_ID,
                    'modelArn': f'arn:aws:bedrock:{os.environ.get("AWS_REGION", "us-west-2")}:{AWS_ACCOUNT_ID}:inference-profile/us.amazon.nova-lite-v1:0'
                }
            }
        )
        
        # Extract response text
        response_text = response['output']['text']
        
        # Extract citations
        citations = []
        if 'citations' in response:
            for citation in response['citations']:
                for reference in citation.get('retrievedReferences', []):
                    citations.append(Citation(
                        title=reference.get('content', {}).get('text', '')[:100] + "...",
                        source=reference.get('location', {}).get('s3Location', {}).get('uri', ''),
                        excerpt=reference.get('content', {}).get('text', '')[:200] + "..."
                    ))
        
        return ChatResponse(
            response=response_text,
            sessionId=session_id,
            citations=citations,
            userId=request.userId
        )
        
    except Exception as e:
        print(f"Error in chat endpoint: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")

@app.post('/feedback')
async def submit_feedback(request: FeedbackRequest):
    """Submit user feedback for responses."""
    try:
        if not (1 <= request.rating <= 5):
            raise HTTPException(status_code=400, detail="Rating must be between 1 and 5")
        
        # Store feedback in DynamoDB
        table = dynamodb.Table(FEEDBACK_TABLE_NAME)
        
        feedback_item = {
            'feedbackId': str(uuid4()),
            'userId': request.userId,
            'responseId': request.responseId,
            'rating': request.rating,
            'feedback': request.feedback or '',
            'timestamp': datetime.utcnow().isoformat(),
            'ttl': int(datetime.utcnow().timestamp()) + (365 * 24 * 60 * 60)  # 1 year TTL
        }
        
        table.put_item(Item=feedback_item)
        
        return {
            "message": "Feedback submitted successfully",
            "feedbackId": feedback_item['feedbackId']
        }
        
    except Exception as e:
        print(f"Error in feedback endpoint: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")

@app.get('/documents')
async def list_documents():
    """List processed documents in the knowledge base."""
    try:
        if not DOCUMENTS_BUCKET:
            raise HTTPException(status_code=500, detail="Documents bucket not configured")
        
        # List objects in the processed folder
        response = s3.list_objects_v2(
            Bucket=DOCUMENTS_BUCKET,
            Prefix='processed/',
            MaxKeys=100
        )
        
        documents = []
        if 'Contents' in response:
            for obj in response['Contents']:
                if obj['Key'] != 'processed/':  # Skip the folder itself
                    documents.append({
                        'key': obj['Key'],
                        'name': obj['Key'].replace('processed/', ''),
                        'size': obj['Size'],
                        'lastModified': obj['LastModified'].isoformat()
                    })
        
        return {
            "documents": documents,
            "count": len(documents)
        }
        
    except Exception as e:
        print(f"Error in documents endpoint: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")

@app.get('/status')
async def get_status():
    """Get system status and configuration."""
    return {
        "service": "iECHO RAG Chatbot API",
        "status": "running",
        "knowledgeBaseConfigured": bool(KNOWLEDGE_BASE_ID),
        "documentsConfigured": bool(DOCUMENTS_BUCKET),
        "feedbackConfigured": bool(FEEDBACK_TABLE_NAME),
        "region": os.environ.get('AWS_REGION', 'us-west-2'),
        "timestamp": datetime.utcnow().isoformat()
    }

if __name__ == '__main__':
    # Get port from environment variable or default to 8000
    port = int(os.environ.get('PORT', 8000))
    uvicorn.run(app, host='0.0.0.0', port=port)
