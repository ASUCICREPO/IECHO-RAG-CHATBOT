# iECHO RAG Chatbot API — Multi-Agent Orchestrator via Strands Framework
# 
# ARCHITECTURE OVERVIEW:
# - Orchestrator Agent: Routes queries to specialized domain agents using natural language
# - Specialist Agents: TB, Agriculture, and General health/education experts
# - Knowledge Base Integration: AWS Bedrock Knowledge Base with vector search
# - Streaming Support: Real-time response streaming with reasoning suppression
# - Session Management: In-memory conversation history with TTL cleanup
# - Image Analysis: Optional image processing via strands_tools.image_reader
# 
# KEY FEATURES:
# - No hardcoded routing - orchestrator decides which specialist to use
# - Streaming and non-streaming endpoints for different use cases
# - Citation tracking from knowledge base responses
# - Follow-up question generation
# - User feedback collection via DynamoDB
# - CloudWatch logging integration
# - Health monitoring and status endpoints

from typing import List, Dict, Optional, Callable
from uuid import uuid4
import os
import json
import boto3
import logging
import asyncio
from datetime import datetime, timezone
from collections import defaultdict
try:
    import tiktoken
except ImportError:
    tiktoken = None

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
import uvicorn
from strands import Agent, tool
try:
    from strands_tools import image_reader
except ImportError:
    image_reader = None

# Conversation managers (in-memory; no persistence)
try:
    from strands.agent.conversation_manager import (
        SlidingWindowConversationManager,
        SummarizingConversationManager,
    )
except ImportError:
    try:
        from strands.conversation_manager import (
            SlidingWindowConversationManager,
            SummarizingConversationManager,
        )
    except ImportError:
        SlidingWindowConversationManager = None
        SummarizingConversationManager = None

# -----------------------------------------------------------------------------
# FastAPI setup
# -----------------------------------------------------------------------------
app = FastAPI(title="iECHO RAG Chatbot API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"], allow_credentials=True,
    allow_methods=["*"], allow_headers=["*"],
)

# -----------------------------------------------------------------------------
# Logging
# -----------------------------------------------------------------------------
logging.basicConfig(level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

def log_to_cloudwatch(message: str, level: str = "INFO"):
    if not os.environ.get('LOG_GROUP'):
        return
    try:
        cloudwatch_logs = boto3.client('logs', region_name=os.environ.get('AWS_REGION', 'us-west-2'))
        stream_name = f"agent-service-{datetime.now(timezone.utc).strftime('%Y-%m-%d')}"
        try:
            cloudwatch_logs.create_log_stream(
                logGroupName=os.environ.get('LOG_GROUP'),
                logStreamName=stream_name
            )
        except cloudwatch_logs.exceptions.ResourceAlreadyExistsException:
            pass
        cloudwatch_logs.put_log_events(
            logGroupName=os.environ.get('LOG_GROUP'),
            logStreamName=stream_name,
            logEvents=[{
                'timestamp': int(datetime.now(timezone.utc).timestamp() * 1000),
                'message': f"[{level}] {message}"
            }]
        )
    except Exception as e:
        print(f"CloudWatch logging failed: {e}")

print(f"Application starting with LOG_GROUP: {os.environ.get('LOG_GROUP')}")

# -----------------------------------------------------------------------------
# AWS clients & env
# -----------------------------------------------------------------------------
bedrock_agent_runtime = boto3.client('bedrock-agent-runtime', region_name=os.environ.get('AWS_REGION', 'us-west-2'))
dynamodb = boto3.resource('dynamodb', region_name=os.environ.get('AWS_REGION', 'us-west-2'))
s3 = boto3.client('s3', region_name=os.environ.get('AWS_REGION', 'us-west-2'))

KNOWLEDGE_BASE_ID = os.environ.get('KNOWLEDGE_BASE_ID', '')
FEEDBACK_TABLE_NAME = os.environ.get('FEEDBACK_TABLE_NAME', 'iecho-feedback-table')
AWS_ACCOUNT_ID = os.environ.get('AWS_ACCOUNT_ID', '')

# -----------------------------------------------------------------------------
# In-memory session store (TTL managed)
# -----------------------------------------------------------------------------
from time import time
conversation_sessions = defaultdict(lambda: {'history': [], 'last_access': time()})

# -----------------------------------------------------------------------------
# Schemas
# -----------------------------------------------------------------------------
class ChatRequest(BaseModel):
    query: str
    userId: str
    sessionId: Optional[str] = None
    image: Optional[str] = None  # Base64 encoded image

class FeedbackRequest(BaseModel):
    userId: str
    responseId: str
    rating: int
    feedback: Optional[str] = None

class Citation(BaseModel):
    title: str
    source: str

class ChatResponse(BaseModel):
    response: str
    sessionId: str
    citations: List[Citation]
    userId: str
    followUpQuestions: Optional[List[str]] = None

# -----------------------------------------------------------------------------
# Prompts
# -----------------------------------------------------------------------------
ORCHESTRATOR_PROMPT = """You are an intelligent assistant for the iECHO platform focused on TB and Agriculture.

Your job is to analyze the user's query and provide a helpful response by calling the appropriate specialist tool.

Analysis tools (use first if needed):
- image_reader: Analyze images to understand visual content

Specialist tools (choose one for final response):
- tb_specialist: Handles tuberculosis-related questions
- agriculture_specialist: Handles agriculture/farming topics  
- general_specialist: Handles health/education topics that relate to TB or agriculture
- reject_handler: Politely declines unrelated queries

CRITICAL RULES:
- If query contains "Image path:", use image_reader FIRST, then route to appropriate specialist
- Always end with exactly one specialist tool call for the final response
- NEVER show tool calls, reasoning, or internal processes to the user
- Only return the clean, helpful response from the specialist
- Route TB-related questions to tb_specialist
- Route agriculture-related questions to agriculture_specialist
- Route ambiguous questions that may connect to TB or agriculture contexts to general_specialist
- Use reject_handler ONLY when the query has no meaningful connection to TB, agriculture, or related health/education contexts
"""

TB_AGENT_PROMPT = """You are a TB specialist. ALWAYS use the kb_search tool to find information, then provide brief, direct answers about:
- TB diagnosis & symptoms; lab tests (smear, GeneXpert), imaging
- Treatment protocols & medications (e.g., HRZE, MDR/XDR management)
- Infection control & prevention strategies
- Patient care guidelines & counseling
Keep responses concise (2–3 sentences). Do NOT reveal internal reasoning.
If image analysis results are provided in the query, use them as additional context.
"""

AGRICULTURE_AGENT_PROMPT = """You are an Agriculture specialist. ALWAYS use the kb_search tool to find information, then provide brief, direct answers about:
- Crop & soil management, irrigation, fertigation, IPM, yield optimization
- Food safety & nutrition, post-harvest handling
- Practical farm best practices & infrastructure
Keep responses concise (2–3 sentences). Do NOT reveal internal reasoning.
If image analysis results are provided in the query, use them as additional context.
"""

# -----------------------------------------------------------------------------
# Utilities
# -----------------------------------------------------------------------------
def count_tokens(text: str) -> int:
    """Count tokens in text using tiktoken for Nova Lite model.
    
    Args:
        text: Input text to count tokens for
        
    Returns:
        Number of tokens in the text
    """
    try:
        if tiktoken:
            # Use cl100k_base encoding which is compatible with most models
            encoding = tiktoken.get_encoding("cl100k_base")
            return len(encoding.encode(text))
    except Exception as e:
        logger.warning(f"Token counting failed: {e}")
    
    # Fallback to character-based estimation
    return len(text) // 4

def filter_thinking_tags(text: str) -> str:
    """Remove any model-inserted thinking tags if they appear in visible output."""
    import re
    text = re.sub(r'<thinking>.*?</thinking>', '', text, flags=re.DOTALL)
    text = re.sub(r'</?thinking[^>]*>', '', text)
    text = re.sub(r'Action: [^\n]*\n?', '', text)
    # Remove decision tokens and any following newlines
    text = re.sub(r'^\s*<(TB|AG|GN|REJECT)>\s*\n*', '', text)
    return text.strip()



def query_knowledge_base(query: str, topic: str, conversation_history: List[str]) -> Dict:
    """Query Bedrock KB (topic used for logging/agent specialization context)."""
    try:
        context_query = query
        if conversation_history:
            recent_user = [h for h in conversation_history[-4:] if h.startswith('User:')]
            if recent_user:
                context_query = f"Previous question: {recent_user[-1]}\nCurrent question: {query}"
            else:
                context_query = f"Context: {' '.join(conversation_history[-2:])}\n\nCurrent question: {query}"
        resp = bedrock_agent_runtime.retrieve_and_generate(
            input={'text': context_query},
            retrieveAndGenerateConfiguration={
                'type': 'KNOWLEDGE_BASE',
                'knowledgeBaseConfiguration': {
                    'knowledgeBaseId': KNOWLEDGE_BASE_ID,
                    'modelArn': f'arn:aws:bedrock:{os.environ.get("AWS_REGION", "us-west-2")}:{AWS_ACCOUNT_ID}:inference-profile/us.amazon.nova-lite-v1:0'
                }
            }
        )
        return resp
    except Exception as e:
        logger.error(f"KB query error: {e}")
        return {'output': {'text': f"I’m having trouble accessing the knowledge base right now. Error: {str(e)}"}}

# --- Stream helpers (reasoning suppression & tool selection tracking) ----------
class ToolChoiceTracker:
    def __init__(self):
        self.name: Optional[str] = None
    def set(self, name: Optional[str]):
        # Only track specialist tools, not analysis tools
        if name and name in ['tb_specialist', 'agriculture_specialist', 'general_specialist', 'reject_handler']:
            self.name = name

def make_streaming_callback(on_tool_start: Optional[Callable[[str], None]] = None):
    """
    Callback that:
      - suppresses reasoning & error events,
      - updates selected tool on tool start (via current_tool_use/name),
      - does not emit text (we forward text from the event iterator).
    """
    def _handler(**kwargs):
        # Suppress reasoning and error-ish signals
        if kwargs.get("reasoning") or kwargs.get("force_stop") or kwargs.get("error") or kwargs.get("exception"):
            return
        # Track tool use
        current_tool_use = kwargs.get("current_tool_use")
        if current_tool_use and on_tool_start:
            name = current_tool_use.get("name")
            if name:
                on_tool_start(name)
    return _handler

# -----------------------------------------------------------------------------
# Specialists & Agents-as-tools
# -----------------------------------------------------------------------------

def make_kb_tool(topic: str, citations_sink: list, conversation_history: List[str]):
    """Returns a KB search tool bound to a specific specialty."""
    @tool
    async def kb_search(user_query: str) -> str:
        """Search iECHO Knowledge Base for this specialty and return a concise answer with citations tracked internally."""
        logger.info(f"KB lookup topic='{topic}' for query='{user_query[:120]}'")
        kb_response = query_knowledge_base(user_query, topic, conversation_history)
        citations_sink.clear()
        seen_sources = set()
        for citation in kb_response.get('citations', []):
            for reference in citation.get('retrievedReferences', []):
                content_text = reference.get('content', {}).get('text', '')
                doc_uri = reference.get('location', {}).get('s3Location', {}).get('uri', '')
                title = doc_uri.split('/')[-1].replace('.pdf', '') if doc_uri else 'Document'
                
                # Only add unique sources
                if doc_uri and doc_uri not in seen_sources:
                    seen_sources.add(doc_uri)
                    citations_sink.append({
                        'title': title, 'source': doc_uri, 'excerpt': content_text
                    })
        return kb_response['output']['text']
    return kb_search

def build_specialists(conversation_history: List[str]):
    """Create 3 specialist Agents, each with its own KB tool & citations sink."""
    tb_citations: List[Dict] = []
    agri_citations: List[Dict] = []
    gen_citations: List[Dict] = []

    # In-memory conversation manager
    if SummarizingConversationManager is not None:
        conv_mgr = SummarizingConversationManager(preserve_recent_messages=10, summary_ratio=0.3)
    elif SlidingWindowConversationManager is not None:
        conv_mgr = SlidingWindowConversationManager(window_size=20, should_truncate_results=True)
    else:
        conv_mgr = None

    # Build tools list (no image_reader at specialist level)
    tb_tools = [make_kb_tool("tuberculosis", tb_citations, conversation_history)]
    agri_tools = [make_kb_tool("agriculture", agri_citations, conversation_history)]
    gen_tools = [make_kb_tool("general", gen_citations, conversation_history)]
    
    tb_agent = Agent(
        system_prompt=TB_AGENT_PROMPT,
        tools=tb_tools,
        model="us.amazon.nova-lite-v1:0",
        conversation_manager=conv_mgr,
    )

    agri_agent = Agent(
        system_prompt=AGRICULTURE_AGENT_PROMPT,
        tools=agri_tools,
        model="us.amazon.nova-lite-v1:0",
        conversation_manager=conv_mgr,
    )

    general_agent = Agent(
        system_prompt="You are a generalist for health/education topics related to TB or agriculture. ALWAYS use the kb_search tool to find information, then provide brief, direct answers. Keep responses concise (2–3 sentences). Do NOT reveal internal reasoning.",
        tools=gen_tools,
        model="us.amazon.nova-lite-v1:0",
        conversation_manager=conv_mgr,
    )

    return {
        "tb": (tb_agent, tb_citations),
        "agri": (agri_agent, agri_citations),
        "general": (general_agent, gen_citations),
    }

def build_orchestrator_tools(conversation_history: List[str]):
    """
    Build tools for the orchestrator including image_reader and specialist agents.
    The orchestrator will decide which one to call; we do not hardcode routing.
    """
    specialists = build_specialists(conversation_history)

    # Store image analysis result to pass to specialists and logs
    context = {'image_analysis': None}
    
    async def _run_agent_and_capture(agent: Agent, query: str) -> str:
        """Run a specialist agent once and capture visible text only (reasoning suppressed)."""
        buffer: List[str] = []
        async for ev in agent.stream_async(query):
            if ev.get("reasoning") or ev.get("force_stop") or ev.get("error") or ev.get("exception"):
                continue
            if "data" in ev:
                chunk = ev["data"]
                if "<thinking>" in chunk or "</thinking>" in chunk:
                    continue
                buffer.append(chunk)
        return filter_thinking_tags("".join(buffer))


    
    @tool
    async def tb_specialist(user_query: str) -> str:
        """TB specialist agent: diagnosis, tests, protocols, MDR/XDR, prevention, patient counseling."""
        agent, _ = specialists["tb"]
        return await _run_agent_and_capture(agent, user_query)

    @tool
    async def agriculture_specialist(user_query: str) -> str:
        """Agriculture specialist agent: crop/soil mgmt, irrigation, IPM, yield, food safety & nutrition, infrastructure."""
        agent, _ = specialists["agri"]
        return await _run_agent_and_capture(agent, user_query)

    @tool
    async def general_specialist(user_query: str) -> str:
        """Generalist agent for topics not covered by TB or Agriculture; concise, practical answers."""
        agent, _ = specialists["general"]
        return await _run_agent_and_capture(agent, user_query)

    @tool
    async def reject_handler(user_query: str) -> str:
        """Politely decline queries unrelated to TB, agriculture, or health topics."""
        return "I'm sorry, but I can only help with questions related to tuberculosis (TB), agriculture, and related health topics. If you have an image related to TB or agriculture, please describe what you'd like to know about it in your question."

    def get_last_citations(tool_name: Optional[str]):
        mapping = {
            "tb_specialist": specialists["tb"][1],
            "agriculture_specialist": specialists["agri"][1],
            "general_specialist": specialists["general"][1],
        }
        return mapping.get(tool_name, [])

    # Build orchestrator tools list
    orchestrator_tools = []
    
    # Add image_reader if available
    if image_reader:
        orchestrator_tools.append(image_reader)
    
    # Add specialist tools
    orchestrator_tools.extend([tb_specialist, agriculture_specialist, general_specialist, reject_handler])
    
    return orchestrator_tools, get_last_citations, context

# -----------------------------------------------------------------------------
# Follow-up generation (unchanged logic; reasoning suppressed by filtering)
# -----------------------------------------------------------------------------
async def generate_follow_up_questions(response_text: str, original_query: str, conversation_history: List[str]) -> List[str]:
    try:
        context = f"Original question: {original_query}\nResponse: {response_text}"
        if conversation_history:
            recent_context = "\n".join(conversation_history[-4:])
            context += f"\nConversation history: {recent_context}"

        prompt = f"""Based on this conversation, generate exactly 3 relevant follow-up questions that a user might naturally ask next.

{context}

Generate questions that:
- Are directly related to the topic discussed
- Help the user dive deeper into the subject
- Are practical and actionable
- Avoid repeating information already covered

Format: Return only the questions, one per line, without numbers or bullets."""

        agent = Agent(
            system_prompt="You are a helpful assistant that generates relevant follow-up questions. Be concise and practical.",
            model="us.amazon.nova-lite-v1:0"
        )

        buf: List[str] = []
        async for ev in agent.stream_async(prompt):
            if ev.get("reasoning") or ev.get("force_stop") or ev.get("error") or ev.get("exception"):
                continue
            if "data" in ev:
                chunk = ev['data']
                if '<thinking>' not in chunk and '</thinking>' not in chunk:
                    buf.append(chunk)

        lines = "".join(buf).strip().split('\n')
        questions = []
        for line in lines:
            line = line.strip()
            if line and '?' in line and len(line) > 10:
                questions.append(line.strip('- *123456789. '))

        # pad if needed (domain-agnostic fallback)
        defaults = [
            "Would you like a step-by-step plan?",
            "Do you want references or further reading?",
            "Should I tailor this to a specific setting?"
        ]
        while len(questions) < 3 and defaults:
            questions.append(defaults.pop(0))

        return questions[:3]
    except Exception as e:
        logger.error(f"Follow-up generation error: {e}")
        return [
            "Would you like a step-by-step plan?",
            "Do you want references or further reading?",
            "Should I tailor this to a specific setting?"
        ]

# -----------------------------------------------------------------------------
# Orchestrator (Streaming)
# -----------------------------------------------------------------------------
async def run_orchestrator_agent(query: str, session_id: str, user_id: str, image: Optional[str] = None):
    # GC old sessions (1h)
    now = time()
    for sid, data in list(conversation_sessions.items()):
        if now - data['last_access'] > 3600:
            del conversation_sessions[sid]

    # Session state
    sess = conversation_sessions[session_id]
    sess['last_access'] = now
    history = sess['history']
    
    # Save image to temp file for image_reader tool
    temp_path = None
    if image:
        import tempfile
        import base64
        import os
        # Detect image format from base64 data
        img_data = base64.b64decode(image)
        if img_data.startswith(b'\x89PNG'):
            ext = '.png'
        elif img_data.startswith(b'\xff\xd8\xff'):
            ext = '.jpg'
        elif img_data.startswith(b'GIF'):
            ext = '.gif'
        elif img_data.startswith(b'RIFF') and b'WEBP' in img_data[:12]:
            ext = '.webp'
        else:
            ext = '.png'  # default
        
        temp_fd, temp_path = tempfile.mkstemp(suffix=ext)
        try:
            with os.fdopen(temp_fd, 'wb') as f:
                f.write(img_data)
            os.chmod(temp_path, 0o644)
            query = f"Image path: {temp_path}\n{query}"
        except Exception as e:
            if temp_path and os.path.exists(temp_path):
                os.unlink(temp_path)
            raise e
    
    tools, get_last_citations, image_context = build_orchestrator_tools(history)

    # Orchestrator conversation manager
    if SummarizingConversationManager is not None:
        orch_mgr = SummarizingConversationManager(preserve_recent_messages=10, summary_ratio=0.3)
    elif SlidingWindowConversationManager is not None:
        orch_mgr = SlidingWindowConversationManager(window_size=20, should_truncate_results=True)
    else:
        orch_mgr = None

    context_prompt = ORCHESTRATOR_PROMPT
    if history:
        recent = "\n".join(history[-4:])
        context_prompt += f"\n\nConversation history:\n{recent}"

    # Track selected tool via callback (no text emitted here)
    tracker = ToolChoiceTracker()
    cb = make_streaming_callback(on_tool_start=tracker.set)

    # Prepare input - images handled by image_reader tool
    input_content = query
    
    orchestrator = Agent(
        system_prompt=context_prompt,
        tools=tools,
        model="us.amazon.nova-lite-v1:0",
        conversation_manager=orch_mgr,
        callback_handler=cb
    )

    full_text = ""
    in_thinking = False
    
    start_time = time()
    timeout_seconds = 25
    
    async for ev in orchestrator.stream_async(input_content):
        # Check timeout
        if time() - start_time > timeout_seconds:
            yield json.dumps({"type": "error", "data": "Request timeout. Please try again."}) + "\n"
            return
            
        # Suppress reasoning/errors
        if ev.get("reasoning") or ev.get("force_stop") or ev.get("error") or ev.get("exception"):
            continue
        # Track tool usage
        if 'tool' in ev and ev.get('phase') in ('start', 'call', 'begin'):
            tracker.set(ev.get('tool'))
        # Forward only visible data
        if "data" in ev:
            chunk = ev["data"]
            
            # Check for thinking tag start/end
            if '<thinking>' in chunk:
                in_thinking = True
            if '</thinking>' in chunk:
                in_thinking = False
                continue
                
            # Skip streaming if in thinking tags
            if in_thinking or '<thinking>' in chunk or '</thinking>' in chunk:
                continue
            
            # Skip empty chunks or chunks with only whitespace/newlines
            if not chunk.strip():
                continue
                
            full_text += chunk
            yield json.dumps({"type": "content", "data": chunk}) + "\n"

    full_text = filter_thinking_tags(full_text)

    # Update session history
    history.append(f"User: {query}")
    history.append(f"Assistant: {full_text}")

    # Citations from the specialist that actually ran (or None)
    chosen_tool = tracker.name
    citations = get_last_citations(chosen_tool)

    response_id = str(uuid4())
    followups = await generate_follow_up_questions(full_text, query, history)

    # Include image analysis in logs (captured after orchestrator execution)
    log_query = query
    if image_context['image_analysis']:
        log_query = f"Query: {query} | Image: {image_context['image_analysis'][:200]}..."
    elif image:
        log_query = f"[IMAGE_PROVIDED] {query}"
    
    log_message = (
        f"Chat complete - User id: {user_id}, Session id: {session_id}, Response id: {response_id}, "
        f"SelectedAgent: {chosen_tool or 'unknown'}, Query: {log_query}, Response: {full_text}, "
        f"Citations: {json.dumps(citations) if citations else '[]'}"
    )
    logger.info(log_message)
    log_to_cloudwatch(log_message)

    # Cleanup temp image file
    if temp_path and os.path.exists(temp_path):
        try:
            os.unlink(temp_path)
        except:
            pass
    
    yield json.dumps({
        "response": full_text,
        "citations": [{"title": c.get("title", ""), "source": c.get("source", "")} for c in citations],
        "sessionId": session_id,
        "responseId": response_id,
        "userId": user_id,
        "followUpQuestions": followups
    }) + "\n"

# -----------------------------------------------------------------------------
# Orchestrator (Non-streaming; parity with streaming)
# -----------------------------------------------------------------------------
async def run_orchestrator_once(query: str, history: List[str], image: Optional[str] = None):
    # Save image to temp file for image_reader tool
    temp_path = None
    if image:
        import tempfile
        import base64
        import os
        # Detect image format from base64 data
        img_data = base64.b64decode(image)
        if img_data.startswith(b'\x89PNG'):
            ext = '.png'
        elif img_data.startswith(b'\xff\xd8\xff'):
            ext = '.jpg'
        elif img_data.startswith(b'GIF'):
            ext = '.gif'
        elif img_data.startswith(b'RIFF') and b'WEBP' in img_data[:12]:
            ext = '.webp'
        else:
            ext = '.png'  # default
        
        temp_fd, temp_path = tempfile.mkstemp(suffix=ext)
        try:
            with os.fdopen(temp_fd, 'wb') as f:
                f.write(img_data)
            os.chmod(temp_path, 0o644)
        except Exception as e:
            if os.path.exists(temp_path):
                os.unlink(temp_path)
            raise e
    
    tools, get_last_citations, image_context = build_orchestrator_tools(history)
    
    # Add image path to query for orchestrator
    if temp_path:
        query = f"Image path: {temp_path}\n{query}"

    if SummarizingConversationManager is not None:
        orch_mgr = SummarizingConversationManager(preserve_recent_messages=10, summary_ratio=0.3)
    elif SlidingWindowConversationManager is not None:
        orch_mgr = SlidingWindowConversationManager(window_size=20, should_truncate_results=True)
    else:
        orch_mgr = None

    tracker = ToolChoiceTracker()
    cb = make_streaming_callback(on_tool_start=tracker.set)

    orchestrator = Agent(
        system_prompt=ORCHESTRATOR_PROMPT,
        tools=tools,
        model="us.amazon.nova-lite-v1:0",
        conversation_manager=orch_mgr,
        callback_handler=cb
    )

    # Prepare input - images handled by image_reader tool
    input_content = query
    
    buffer: List[str] = []
    async for ev in orchestrator.stream_async(input_content):
        if ev.get("reasoning") or ev.get("force_stop") or ev.get("error") or ev.get("exception"):
            continue
        if 'tool' in ev and ev.get('phase') in ('start', 'call', 'begin'):
            tracker.set(ev.get('tool'))
        if "data" in ev:
            chunk = ev["data"]
            if "<thinking>" in chunk or "</thinking>" in chunk:
                continue
            buffer.append(chunk)

    text = filter_thinking_tags("".join(buffer))
    citations = get_last_citations(tracker.name)
    
    # Cleanup temp image file
    if temp_path and os.path.exists(temp_path):
        try:
            os.unlink(temp_path)
        except:
            pass
    
    return text, citations, tracker.name

# -----------------------------------------------------------------------------
# FastAPI endpoints
# -----------------------------------------------------------------------------
@app.get('/health')
def health_check():
    return {
        "status": "healthy",
        "service": "iECHO RAG Chatbot API",
        "timestamp": datetime.now(timezone.utc).isoformat()
    }

@app.post('/chat')
async def chat(request: ChatRequest):
    try:
        if not request.query.strip():
            raise HTTPException(status_code=400, detail="Query cannot be empty")
        token_count = count_tokens(request.query)
        if token_count > 150:
            raise HTTPException(status_code=400, detail=f"Query too long. {token_count} tokens provided, maximum 150 tokens allowed.")
        if request.image and len(request.image) > 5 * 1024 * 1024:
            raise HTTPException(status_code=413, detail="Image too large. Maximum size is 5MB.")
        if not KNOWLEDGE_BASE_ID:
            raise HTTPException(status_code=500, detail="Knowledge Base not configured")

        session_id = request.sessionId or str(uuid4())
        response_id = str(uuid4())

        sess = conversation_sessions[session_id]
        sess['last_access'] = time()
        history = sess['history']

        response_text, citations, chosen_tool = await run_orchestrator_once(request.query, history, request.image)

        # Update history
        history.append(f"User: {request.query}")
        history.append(f"Assistant: {response_text}")

        followups = await generate_follow_up_questions(response_text, request.query, history)

        # Log with selected agent and image context if available
        log_query = request.query
        if request.image:
            log_query = f"[IMAGE_PROVIDED] {request.query}"
        
        log_message = (
            f"Chat complete - User: {request.userId}, Session: {session_id}, Response: {response_id}, "
            f"SelectedAgent: {chosen_tool or 'unknown'}, Query: {log_query}, Response: {response_text}, "
            f"Citations: {json.dumps(citations) if citations else '[]'}"
        )
        logger.info(log_message)
        log_to_cloudwatch(log_message)

        return {
            "response": response_text,
            "citations": [{"title": c.get("title", ""), "source": c.get("source", "")} for c in citations],
            "sessionId": session_id,
            "responseId": response_id,
            "userId": request.userId,
            "followUpQuestions": followups
        }

    except Exception as e:
        logger.error(f"Error in chat endpoint: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")

@app.post('/chat-stream')
async def chat_stream(request: ChatRequest):
    try:
        if not request.query.strip():
            raise HTTPException(status_code=400, detail="Query cannot be empty")
        token_count = count_tokens(request.query)
        if token_count > 150:
            raise HTTPException(status_code=400, detail=f"Query too long. {token_count} tokens provided, maximum 150 tokens allowed.")
        if request.image and len(request.image) > 5 * 1024 * 1024:
            raise HTTPException(status_code=413, detail="Image too large. Maximum size is 5MB.")
        if not KNOWLEDGE_BASE_ID:
            raise HTTPException(status_code=500, detail="Knowledge Base not configured")

        session_id = request.sessionId or str(uuid4())
        return StreamingResponse(
            run_orchestrator_agent(request.query, session_id, request.userId, request.image),
            media_type="application/x-ndjson"
        )

    except Exception as e:
        logger.error(f"Error in chat-stream endpoint: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")

@app.post('/feedback')
async def submit_feedback(request: FeedbackRequest):
    try:
        if not (1 <= request.rating <= 5):
            raise HTTPException(status_code=400, detail="Rating must be between 1 and 5")

        table = dynamodb.Table(FEEDBACK_TABLE_NAME)
        item = {
            'feedbackId': str(uuid4()),
            'userId': request.userId,
            'responseId': request.responseId,
            'rating': request.rating,
            'feedback': request.feedback or '',
            'timestamp': datetime.now(timezone.utc).isoformat()
        }
        table.put_item(Item=item)

        log_message = (f"Feedback submitted - User: {request.userId}, Response: {request.responseId}, "
                       f"Rating: {request.rating}, Feedback: {request.feedback or 'None'}, "
                       f"FeedbackId: {item['feedbackId']}")
        logger.info(log_message)
        log_to_cloudwatch(log_message)

        return {"message": "Feedback submitted successfully", "feedbackId": item['feedbackId']}

    except Exception as e:
        logger.error(f"Error in feedback endpoint: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")

@app.get('/documents')
async def list_documents():
    try:
        if not KNOWLEDGE_BASE_ID:
            raise HTTPException(status_code=500, detail="Knowledge Base not configured")

        bedrock = boto3.client('bedrock-agent', region_name=os.environ.get('AWS_REGION', 'us-west-2'))
        data_sources = bedrock.list_data_sources(knowledgeBaseId=KNOWLEDGE_BASE_ID)
        if not data_sources.get('dataSourceSummaries'):
            raise HTTPException(status_code=500, detail="No data sources found in Knowledge Base")

        data_source = data_sources['dataSourceSummaries'][0]
        detail = bedrock.get_data_source(
            knowledgeBaseId=KNOWLEDGE_BASE_ID,
            dataSourceId=data_source['dataSourceId']
        )
        s3_cfg = detail['dataSource']['dataSourceConfiguration']['s3Configuration']
        bucket_name = s3_cfg['bucketArn'].split(':')[-1]

        resp = s3.list_objects_v2(Bucket=bucket_name, Prefix='processed/', MaxKeys=100)
        docs = []
        for obj in resp.get('Contents', []):
            if obj['Key'] != 'processed/':
                docs.append({
                    'key': obj['Key'],
                    'name': obj['Key'].replace('processed/', ''),
                    'size': obj['Size'],
                    'lastModified': obj['LastModified'].isoformat()
                })
        return {"documents": docs, "count": len(docs)}

    except Exception as e:
        logger.error(f"Error in documents endpoint: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")

@app.get('/document-url/{path:path}')
async def get_document_url(path: str):
    try:
        if not path.startswith('s3://'):
            raise HTTPException(status_code=400, detail="Invalid S3 URL format")
        parts = path.replace('s3://', '').split('/', 1)
        bucket = parts[0]
        key = parts[1] if len(parts) > 1 else ''
        url = s3.generate_presigned_url('get_object', Params={'Bucket': bucket, 'Key': key}, ExpiresIn=3600)
        return {"url": url}
    except Exception as e:
        logger.error(f"Error generating presigned URL: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Failed to generate document URL: {str(e)}")

@app.get('/status')
async def get_status():
    return {
        "service": "iECHO RAG Chatbot API",
        "status": "running",
        "knowledgeBaseConfigured": bool(KNOWLEDGE_BASE_ID),
        "documentsConfigured": bool(KNOWLEDGE_BASE_ID),
        "feedbackConfigured": bool(FEEDBACK_TABLE_NAME),
        "region": os.environ.get('AWS_REGION', 'us-west-2'),
        "timestamp": datetime.now(timezone.utc).isoformat()
    }

if __name__ == '__main__':
    port = int(os.environ.get('PORT', 8000))
    uvicorn.run(app, host='0.0.0.0', port=port)
