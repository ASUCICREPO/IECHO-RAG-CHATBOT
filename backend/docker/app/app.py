from typing import List, Dict, Optional
from uuid import uuid4
import os
import json
import boto3
import logging
from datetime import datetime
from collections import defaultdict

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
import uvicorn
from strands import Agent, tool

app = FastAPI(title="iECHO RAG Chatbot API")

# Add CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Configure logging with CloudWatch
import watchtower

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# Add CloudWatch handler if LOG_GROUP is set
if os.environ.get('LOG_GROUP'):
    try:
        cloudwatch_handler = watchtower.CloudWatchLogsHandler(
            log_group=os.environ.get('LOG_GROUP'),
            stream_name='agent-service',
            use_queues=False
        )
        logger.addHandler(cloudwatch_handler)
    except Exception as e:
        print(f"Failed to setup CloudWatch logging: {e}")

# Initialize AWS clients
bedrock_agent_runtime = boto3.client('bedrock-agent-runtime', region_name=os.environ.get('AWS_REGION', 'us-west-2'))
dynamodb = boto3.resource('dynamodb', region_name=os.environ.get('AWS_REGION', 'us-west-2'))
s3 = boto3.client('s3', region_name=os.environ.get('AWS_REGION', 'us-west-2'))

# Environment variables
KNOWLEDGE_BASE_ID = os.environ.get('KNOWLEDGE_BASE_ID', '')
FEEDBACK_TABLE_NAME = os.environ.get('FEEDBACK_TABLE_NAME', 'iecho-feedback-table')
DOCUMENTS_BUCKET = os.environ.get('DOCUMENTS_BUCKET', '')
AWS_ACCOUNT_ID = os.environ.get('AWS_ACCOUNT_ID', '')

# Session storage for conversation context
conversation_sessions = defaultdict(list)

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

# System prompts
ORCHESTRATOR_PROMPT = """You are an intelligent assistant orchestrator for the iECHO platform. Your role is to:

1. Analyze user queries and determine the appropriate domain
2. Route queries to the correct specialist agent
3. Maintain conversation context and continuity
4. Provide helpful responses when queries don't fit specific domains

Available specialist agents:
- TB Agent: Handles tuberculosis-related questions, treatment, diagnosis, prevention
- Agriculture Agent: Handles agriculture, farming, food safety, nutrition, water management, irrigation, and agricultural infrastructure

When routing:
- If the query is about tuberculosis, TB treatment, diagnosis → use TB agent
- If the query is about agriculture, farming, food safety, nutrition, water management, irrigation, agricultural infrastructure → use Agriculture agent
- Water-related topics (irrigation, water efficiency, Non-Revenue Water) should go to Agriculture agent as they directly impact farming
- Choose the most relevant agent based on the primary topic

Always maintain conversation flow and context. Reference previous messages when relevant.
"""

TB_AGENT_PROMPT = """You are a specialized TB (Tuberculosis) assistant. Focus ONLY on tuberculosis-related topics including:

- TB diagnosis and symptoms
- Treatment protocols and medications
- Prevention strategies
- Patient care guidelines
- Drug-resistant TB management
- Contact tracing and screening

Only use information specifically related to tuberculosis. Do not provide information about other diseases or topics.

When you have the information needed to provide a comprehensive response, call the ready_to_respond tool and then provide your detailed answer.
"""

AGRICULTURE_AGENT_PROMPT = """You are a specialized Agriculture assistant. Focus on agriculture-related topics including:

- Agricultural practices and techniques
- Food safety and nutrition
- Crop health and disease management
- Farming best practices
- Pesticide safety
- Agricultural health and safety
- Water management and irrigation (including water efficiency, conservation, distribution systems)
- Soil and water conservation
- Agricultural infrastructure and utilities
- Farm resource management
- Environmental factors affecting agriculture

Include topics that directly impact agricultural productivity, sustainability, and farm operations, even if they span multiple domains like water management, environmental health, or infrastructure.

When you have the information needed to provide a comprehensive response, call the ready_to_respond tool and then provide your detailed answer.
"""



def query_knowledge_base(query: str, topic: str, conversation_history: List[str]) -> Dict:
    """Query Bedrock knowledge base with topic-specific filtering"""
    try:
        # Build context-aware query
        context_query = query
        if conversation_history:
            recent_context = " ".join(conversation_history[-2:])
            context_query = f"Previous context: {recent_context}\n\nQuestion: {query}"
        
        response = bedrock_agent_runtime.retrieve_and_generate(
            input={'text': context_query},
            retrieveAndGenerateConfiguration={
                'type': 'KNOWLEDGE_BASE',
                'knowledgeBaseConfiguration': {
                    'knowledgeBaseId': KNOWLEDGE_BASE_ID,
                    'modelArn': f'arn:aws:bedrock:{os.environ.get("AWS_REGION", "us-west-2")}:{AWS_ACCOUNT_ID}:inference-profile/us.amazon.nova-lite-v1:0'
                }
            }
        )
        return response
    except Exception as e:
        logger.error(f"Error querying knowledge base: {str(e)}")
        return {'output': {'text': f"I apologize, but I'm having trouble accessing the knowledge base right now. Error: {str(e)}"}}

async def run_orchestrator_agent(query: str, session_id: str, user_id: str):
    """Run the main orchestration agent with streaming response"""
    conversation_history = conversation_sessions[session_id]
    current_citations = []
    
    @tool
    def route_to_tb_agent(user_query: str) -> str:
        """Route the query to the TB specialist agent for tuberculosis-related questions"""
        nonlocal current_citations
        kb_response = query_knowledge_base(user_query, "tuberculosis", conversation_history)
        
        if 'citations' in kb_response:
            for citation in kb_response['citations']:
                for reference in citation.get('retrievedReferences', []):
                    current_citations.append({
                        'title': reference.get('content', {}).get('text', '')[:100] + "...",
                        'source': reference.get('location', {}).get('s3Location', {}).get('uri', ''),
                        'excerpt': reference.get('content', {}).get('text', '')[:200] + "..."
                    })
        
        return f"TB Knowledge: {kb_response['output']['text']}"
    
    @tool
    def route_to_agriculture_agent(user_query: str) -> str:
        """Route the query to the Agriculture specialist agent for farming and food safety questions"""
        nonlocal current_citations
        kb_response = query_knowledge_base(user_query, "agriculture", conversation_history)
        
        if 'citations' in kb_response:
            for citation in kb_response['citations']:
                for reference in citation.get('retrievedReferences', []):
                    current_citations.append({
                        'title': reference.get('content', {}).get('text', '')[:100] + "...",
                        'source': reference.get('location', {}).get('s3Location', {}).get('uri', ''),
                        'excerpt': reference.get('content', {}).get('text', '')[:200] + "..."
                    })
        
        return f"Agriculture Knowledge: {kb_response['output']['text']}"
    
    # Build conversation context  
    context_prompt = ORCHESTRATOR_PROMPT + "\n\nProvide a direct, helpful response based on the knowledge retrieved. Do not use thinking tags or repeat information."
    if conversation_history:
        context_prompt += f"\n\nConversation history:\n" + "\n".join(conversation_history[-4:])
    
    orchestrator = Agent(
        system_prompt=context_prompt,
        tools=[route_to_tb_agent, route_to_agriculture_agent],
        model="us.amazon.nova-lite-v1:0"
    )
    
    full_response = ""
    async for item in orchestrator.stream_async(query):
        if "data" in item:
            chunk = item['data']
            full_response += chunk
            yield json.dumps({
                "type": "content",
                "data": chunk
            }) + "\n"
    
    # Update conversation history
    conversation_history.append(f"User: {query}")
    conversation_history.append(f"Assistant: {full_response}")
    
    # Send citations at the end
    if current_citations:
        yield json.dumps({
            "type": "citations",
            "data": current_citations
        }) + "\n"
    
    # Log complete conversation
    logger.info(f"Chat complete - User: {user_id}, Session: {session_id}, Query: {query}, Response: {full_response}")
    
    # Send completion signal
    yield json.dumps({
        "type": "complete",
        "data": {
            "sessionId": session_id,
            "userId": user_id,
            "response": full_response,
            "citations": current_citations
        }
    }) + "\n"

@app.get('/health')
def health_check():
    """Health check endpoint for the load balancer."""
    return {
        "status": "healthy",
        "service": "iECHO RAG Chatbot API",
        "timestamp": datetime.utcnow().isoformat()
    }

@app.post('/chat')
async def chat(request: ChatRequest):
    """Send a chat message and receive AI-generated streaming response."""
    try:
        if not request.query.strip():
            raise HTTPException(status_code=400, detail="Query cannot be empty")
        
        if not KNOWLEDGE_BASE_ID:
            raise HTTPException(status_code=500, detail="Knowledge Base not configured")
        
        # Generate session ID if not provided
        session_id = request.sessionId or str(uuid4())
        

        
        return StreamingResponse(
            run_orchestrator_agent(request.query, session_id, request.userId),
            media_type="application/x-ndjson"
        )
        
    except Exception as e:
        logger.error(f"Error in chat endpoint: {str(e)}")
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
        logger.error(f"Error in feedback endpoint: {str(e)}")
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
        logger.error(f"Error in documents endpoint: {str(e)}")
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