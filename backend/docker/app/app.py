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

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# CloudWatch logging function
def log_to_cloudwatch(message: str, level: str = "INFO"):
    """Send log message directly to CloudWatch"""
    if not os.environ.get('LOG_GROUP'):
        return
    
    try:
        cloudwatch_logs = boto3.client('logs', region_name=os.environ.get('AWS_REGION', 'us-west-2'))
        
        # Create log stream if it doesn't exist
        stream_name = f"agent-service-{datetime.utcnow().strftime('%Y-%m-%d')}"
        try:
            cloudwatch_logs.create_log_stream(
                logGroupName=os.environ.get('LOG_GROUP'),
                logStreamName=stream_name
            )
        except cloudwatch_logs.exceptions.ResourceAlreadyExistsException:
            pass
        
        # Send log event
        cloudwatch_logs.put_log_events(
            logGroupName=os.environ.get('LOG_GROUP'),
            logStreamName=stream_name,
            logEvents=[
                {
                    'timestamp': int(datetime.utcnow().timestamp() * 1000),
                    'message': f"[{level}] {message}"
                }
            ]
        )
    except Exception as e:
        print(f"CloudWatch logging failed: {e}")

print(f"Application starting with LOG_GROUP: {os.environ.get('LOG_GROUP')}")

# Initialize AWS clients
bedrock_agent_runtime = boto3.client('bedrock-agent-runtime', region_name=os.environ.get('AWS_REGION', 'us-west-2'))
dynamodb = boto3.resource('dynamodb', region_name=os.environ.get('AWS_REGION', 'us-west-2'))
s3 = boto3.client('s3', region_name=os.environ.get('AWS_REGION', 'us-west-2'))

# Environment variables
KNOWLEDGE_BASE_ID = os.environ.get('KNOWLEDGE_BASE_ID', '')
FEEDBACK_TABLE_NAME = os.environ.get('FEEDBACK_TABLE_NAME', 'iecho-feedback-table')
AWS_ACCOUNT_ID = os.environ.get('AWS_ACCOUNT_ID', '')

# Session storage for conversation context (with TTL)
from time import time
conversation_sessions = defaultdict(lambda: {'history': [], 'last_access': time()})

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
ORCHESTRATOR_PROMPT = """You are an intelligent assistant for the iECHO platform. Provide direct, concise, and helpful responses.

Available specialist agents:
- TB Agent: Handles tuberculosis-related questions, treatment, diagnosis, prevention
- Agriculture Agent: Handles agriculture, farming, food safety, nutrition, water management, irrigation, and agricultural infrastructure

Routing rules:
- TB topics → use TB agent
- Agriculture, farming, water management topics → use Agriculture agent
- Water-related topics (irrigation, Non-Revenue Water) → use Agriculture agent

CRITICAL RULES:
- NEVER use <thinking> tags or show internal reasoning
- NEVER expose your thought process to users
- Provide only the final answer, not your reasoning
- Be direct and professional
- Keep responses brief (2-3 sentences max)
- Start your response immediately with the answer
"""

TB_AGENT_PROMPT = """You are a TB specialist. Provide brief, direct answers about tuberculosis topics:

- TB diagnosis and symptoms
- Treatment protocols and medications  
- Prevention strategies
- Patient care guidelines

Keep responses concise (2-3 sentences). Focus only on tuberculosis. Do NOT use thinking tags.
"""

AGRICULTURE_AGENT_PROMPT = """You are an Agriculture specialist. Provide brief, direct answers about:

- Agricultural practices and techniques
- Food safety and nutrition
- Water management and irrigation
- Farming best practices
- Agricultural infrastructure

Keep responses concise (2-3 sentences). Focus on practical, actionable information. Do NOT use thinking tags.
"""



def filter_thinking_tags(text: str) -> str:
    """Remove thinking tags and internal reasoning from response"""
    import re
    # Remove thinking tags and their content
    text = re.sub(r'<thinking>.*?</thinking>', '', text, flags=re.DOTALL)
    # Remove any remaining thinking tag fragments
    text = re.sub(r'</?thinking[^>]*>', '', text)
    return text.strip()

def query_knowledge_base(query: str, topic: str, conversation_history: List[str]) -> Dict:
    """Query Bedrock knowledge base with topic-specific filtering"""
    try:
        # Build context-aware query
        context_query = query
        if conversation_history:
            recent_context = " ".join(conversation_history[-4:])
            context_query = f"Context: {recent_context}\n\nCurrent question: {query}"
        
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

def create_agent_tools(conversation_history: List[str] = None):
    """Create reusable agent tools"""
    if conversation_history is None:
        conversation_history = []
    
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
        
        return kb_response['output']['text']
    
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
        
        return kb_response['output']['text']
    
    return [route_to_tb_agent, route_to_agriculture_agent], current_citations

async def run_orchestrator_agent(query: str, session_id: str, user_id: str):
    """Run the main orchestration agent with streaming response"""
    # Clean old sessions (older than 1 hour)
    current_time = time()
    expired_sessions = [sid for sid, data in conversation_sessions.items() 
                       if current_time - data['last_access'] > 3600]
    for sid in expired_sessions:
        del conversation_sessions[sid]
    
    # Get or create session
    session_data = conversation_sessions[session_id]
    session_data['last_access'] = current_time
    conversation_history = session_data['history']
    current_citations = []
    
    # Use shared tools
    tools, current_citations = create_agent_tools(conversation_history)
    
    # Build conversation context  
    context_prompt = ORCHESTRATOR_PROMPT
    if conversation_history:
        context_prompt += f"\n\nConversation history:\n" + "\n".join(conversation_history[-4:])
    
    orchestrator = Agent(
        system_prompt=context_prompt,
        tools=tools,
        model="us.amazon.nova-lite-v1:0"
    )
    
    full_response = ""
    in_thinking = False
    
    async for item in orchestrator.stream_async(query):
        if "data" in item:
            chunk = item['data']
            
            # Check for thinking tag start/end
            if '<thinking>' in chunk:
                in_thinking = True
            if '</thinking>' in chunk:
                in_thinking = False
                continue
                
            # Skip streaming if in thinking tags
            if in_thinking or '<thinking>' in chunk or '</thinking>' in chunk:
                continue
                
            full_response += chunk
            yield json.dumps({
                "type": "content",
                "data": chunk
            }) + "\n"
    
    # Clean up any remaining content
    full_response = filter_thinking_tags(full_response)
    
    # Update conversation history
    conversation_history.append(f"User: {query}")
    conversation_history.append(f"Assistant: {full_response}")
    
    # Generate unique response ID for this specific response
    response_id = str(uuid4())
    
    # Log complete conversation
    citations_log = json.dumps(current_citations) if current_citations else "[]"
    log_message = f"Chat complete - User: {user_id}, Session: {session_id}, Response: {response_id}, Query: {query}, Response: {full_response}, Citations: {citations_log}"
    logger.info(log_message)
    log_to_cloudwatch(log_message)
    print(f"Chat complete - User: {user_id}, Session: {session_id}, Response: {response_id}, Query: {query}, Response: {full_response[:200]}...")
    
    # Send final response with citations
    yield json.dumps({
        "response": full_response,
        "citations": current_citations,
        "sessionId": session_id,
        "responseId": response_id,
        "userId": user_id
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
    """Fast non-streaming chat with agent routing for API Gateway compatibility."""
    try:
        if not request.query.strip():
            raise HTTPException(status_code=400, detail="Query cannot be empty")
        
        if not KNOWLEDGE_BASE_ID:
            raise HTTPException(status_code=500, detail="Knowledge Base not configured")
        
        session_id = request.sessionId or str(uuid4())
        response_id = str(uuid4())
        
        # Use same agent routing as streaming endpoint
        tools, current_citations = create_agent_tools([])
        
        # Fast agent without streaming
        agent = Agent(
            system_prompt=ORCHESTRATOR_PROMPT,
            tools=tools,
            model="us.amazon.nova-lite-v1:0"
        )
        
        # Collect full response from streaming
        full_response = ""
        async for item in agent.stream_async(request.query):
            if "data" in item:
                chunk = item['data']
                if '<thinking>' not in chunk and '</thinking>' not in chunk:
                    full_response += chunk
        
        response_text = filter_thinking_tags(full_response)
        citations = current_citations
        
        # Log
        log_message = f"Chat complete - User: {request.userId}, Session: {session_id}, Response: {response_id}, Query: {request.query}, Response: {response_text}"
        logger.info(log_message)
        log_to_cloudwatch(log_message)
        
        return {
            "response": response_text,
            "citations": citations,
            "sessionId": session_id,
            "responseId": response_id,
            "userId": request.userId
        }
        
    except Exception as e:
        logger.error(f"Error in chat endpoint: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")

@app.post('/chat-stream')
async def chat_stream(request: ChatRequest):
    """Streaming chat endpoint for direct ALB access."""
    try:
        if not request.query.strip():
            raise HTTPException(status_code=400, detail="Query cannot be empty")
        
        if not KNOWLEDGE_BASE_ID:
            raise HTTPException(status_code=500, detail="Knowledge Base not configured")
        
        session_id = request.sessionId or str(uuid4())
        
        return StreamingResponse(
            run_orchestrator_agent(request.query, session_id, request.userId),
            media_type="application/x-ndjson"
        )
        
    except Exception as e:
        logger.error(f"Error in chat-stream endpoint: {str(e)}")
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
        if not KNOWLEDGE_BASE_ID:
            raise HTTPException(status_code=500, detail="Knowledge Base not configured")
        
        # Get data sources from Knowledge Base
        bedrock = boto3.client('bedrock-agent', region_name=os.environ.get('AWS_REGION', 'us-west-2'))
        data_sources = bedrock.list_data_sources(knowledgeBaseId=KNOWLEDGE_BASE_ID)
        
        if not data_sources.get('dataSourceSummaries'):
            raise HTTPException(status_code=500, detail="No data sources found in Knowledge Base")
        
        # Get S3 bucket from first data source
        data_source = data_sources['dataSourceSummaries'][0]
        data_source_detail = bedrock.get_data_source(
            knowledgeBaseId=KNOWLEDGE_BASE_ID,
            dataSourceId=data_source['dataSourceId']
        )
        
        s3_config = data_source_detail['dataSource']['dataSourceConfiguration']['s3Configuration']
        bucket_name = s3_config['bucketArn'].split(':')[-1]
        
        # List objects in the processed folder
        response = s3.list_objects_v2(
            Bucket=bucket_name,
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
        "documentsConfigured": bool(KNOWLEDGE_BASE_ID),
        "feedbackConfigured": bool(FEEDBACK_TABLE_NAME),
        "region": os.environ.get('AWS_REGION', 'us-west-2'),
        "timestamp": datetime.utcnow().isoformat()
    }

if __name__ == '__main__':
    # Get port from environment variable or default to 8000
    port = int(os.environ.get('PORT', 8000))
    uvicorn.run(app, host='0.0.0.0', port=port)