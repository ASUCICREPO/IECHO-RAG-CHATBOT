# iECHO RAG Chatbot API — Multi-Agent Orchestrator via Strands Framework
#
# ========================= WHAT THIS SERVICE DOES =========================
# - Exposes a FastAPI app that fronts a multi-agent orchestration pipeline.
# - Uses the Strands framework's Agent abstraction with @tool functions.
# - The Orchestrator agent dynamically chooses ONE specialist agent:
#     * tb_specialist  (tuberculosis/health)
#     * agriculture_specialist (agriculture/farming)
#     * reject_handler (politely declines if out of scope)
# - Integrates with AWS Bedrock Knowledge Base (RetrieveAndGenerate) for RAG.
# - Supports both streaming (/chat-stream) and non-streaming (/chat) endpoints.
# - Tracks citations from KB results and returns them with answers.
# - Maintains short in-memory conversation history per session (TTL cleanup).
# - Optionally analyzes a base64 image via strands_tools.image_reader (if present).
# - Logs locally and best-effort to CloudWatch Logs (if LOG_GROUP is provided).
# - Accepts star-wide CORS for browser access (safe to restrict in production).
# ========================================================================

from typing import List, Dict, Optional, Callable  # Static typing for clarity & editor support
from uuid import uuid4                            # Unique identifiers for responses/feedback
import os                                         # Read environment vars injected by K8s
import json                                       # Serialize NDJSON stream chunks / log details
import boto3                                      # AWS SDK (Bedrock Agent Runtime, DynamoDB, S3, CW Logs)
import logging                                    # Server-side logging
import asyncio                                    # Async support used by Strands .stream_async()
from datetime import datetime, timezone           # UTC timestamps for logs and responses
from collections import defaultdict               # Simple TTL-enabled in-memory session store

# --------------------------- FastAPI stack -----------------------------------
from fastapi import FastAPI, HTTPException                # Web app + structured errors
from fastapi.middleware.cors import CORSMiddleware        # Allow cross-origin web clients
from fastapi.responses import StreamingResponse           # NDJSON streaming for tokens
from pydantic import BaseModel                            # Request/response models
import uvicorn                                            # Local dev ASGI server runner
from strands import Agent, tool                           # Strands Agent + @tool decorator

# ------------------ Optional tools (lazy import for resilience) --------------
try:
    from strands_tools import image_reader  # Tool to analyze local image files by path
except ImportError:
    image_reader = None                     # If absent, the system runs without image analysis

# ---------------- Conversation managers (support multiple Strands versions) ---
# The code tries two import paths, then falls back to None (no conv manager).
try:
    from strands.agent.conversation_manager import (
        SlidingWindowConversationManager,     # Keeps last N messages verbatim
        SummarizingConversationManager,       # Summarizes older context
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
# FastAPI setup: app instance + CORS
# -----------------------------------------------------------------------------
app = FastAPI(title="iECHO RAG Chatbot API")  # Title used in docs (e.g., /docs)

# CORS: open to any origin for ease of integration; consider restricting in prod.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],          # e.g., set to ["https://your-frontend.example"] in prod
    allow_credentials=False,      # No cookie-based auth here
    allow_methods=["*"],          # Allow all HTTP methods
    allow_headers=["*"],          # Allow all custom headers
)

# -----------------------------------------------------------------------------
# Logging: Python logger + best-effort CloudWatch Log emitter
# -----------------------------------------------------------------------------
logging.basicConfig(
    level=logging.INFO,           # Default to INFO; raise to DEBUG during dev
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)  # Module-level logger

def log_to_cloudwatch(message: str, level: str = "INFO", error_details: Optional[Dict] = None):
    """
    Emit a single event to CloudWatch Logs if LOG_GROUP is configured; otherwise print().
    - Uses a daily log stream name (agent-service-YYYY-MM-DD).
    - Creates the stream if it doesn't exist.
    - Swallows exceptions to avoid failing the request path due to logging issues.
    """
    if not os.environ.get('LOG_GROUP'):
        # Fall back to stdout if not bound to a CW logs group
        print(f"[{level}] {message}")
        return
    try:
        # Region falls back to us-west-2 unless AWS_REGION was explicitly set
        cloudwatch_logs = boto3.client('logs', region_name=os.environ.get('AWS_REGION', 'us-west-2'))
        stream_name = f"agent-service-{datetime.now(timezone.utc).strftime('%Y-%m-%d')}"
        try:
            # Idempotent create; ignore if already exists
            cloudwatch_logs.create_log_stream(
                logGroupName=os.environ.get('LOG_GROUP'),
                logStreamName=stream_name
            )
        except cloudwatch_logs.exceptions.ResourceAlreadyExistsException:
            pass

        # Construct message payload; append structured error context if provided
        log_message = f"[{level}] {message}"
        if error_details:
            log_message += f" | Error Details: {json.dumps(error_details)}"
            
        # Send a single event; note: sequenceToken handling not required on fresh streams
        cloudwatch_logs.put_log_events(
            logGroupName=os.environ.get('LOG_GROUP'),
            logStreamName=stream_name,
            logEvents=[{
                'timestamp': int(datetime.now(timezone.utc).timestamp() * 1000),
                'message': log_message
            }]
        )
    except Exception as e:
        # Do not break the request because of logging failures
        print(f"CloudWatch logging failed: {e} | Original message: [{level}] {message}")

# -----------------------------------------------------------------------------
# AWS clients & env configuration
# -----------------------------------------------------------------------------
# Create AWS clients early; clients are thread-safe and reused across requests
bedrock_agent_runtime = boto3.client(
    'bedrock-agent-runtime',
    region_name=os.environ.get('AWS_REGION', 'us-west-2')
)
dynamodb = boto3.resource(
    'dynamodb',
    region_name=os.environ.get('AWS_REGION', 'us-west-2')
)
s3 = boto3.client(
    's3',
    region_name=os.environ.get('AWS_REGION', 'us-west-2')
)

# Env vars are injected via K8s Deployment env:
# - KNOWLEDGE_BASE_ID: Bedrock KB ID used by RetrieveAndGenerate
# - FEEDBACK_TABLE_NAME: DynamoDB table name for user feedback
# - AWS_ACCOUNT_ID: used to build Bedrock inference-profile ARNs
KNOWLEDGE_BASE_ID = os.environ.get('KNOWLEDGE_BASE_ID', '')                  # REQUIRED for /chat endpoints
FEEDBACK_TABLE_NAME = os.environ.get('FEEDBACK_TABLE_NAME', 'iecho-feedback-table')
AWS_ACCOUNT_ID = os.environ.get('AWS_ACCOUNT_ID', '')                        # Required for model ARN composition

# Early boot logging (stdout + CloudWatch if configured)
print(f"Application starting with LOG_GROUP: {os.environ.get('LOG_GROUP')}")
log_to_cloudwatch(
    f"Application started - LOG_GROUP: {os.environ.get('LOG_GROUP')}, "
    f"KB_ID: {KNOWLEDGE_BASE_ID}, Region: {os.environ.get('AWS_REGION', 'us-west-2')}"
)

# -----------------------------------------------------------------------------
# In-memory session store: session_id -> {history: [...], last_access: ts}
# -----------------------------------------------------------------------------
from time import time
# defaultdict ensures new sessions automatically get shape {'history': [], 'last_access': now}
conversation_sessions = defaultdict(lambda: {'history': [], 'last_access': time()})

# -----------------------------------------------------------------------------
# Pydantic Schemas (input/output contracts)
# -----------------------------------------------------------------------------
class ChatRequest(BaseModel):
    query: str                              # User's question/prompt (text)
    userId: str                             # Arbitrary user identifier (echoed in responses/logs)
    sessionId: Optional[str] = None         # Client-provided session; if None we generate one
    image: Optional[str] = None             # Base64 string of an image (optional)

class FeedbackRequest(BaseModel):
    userId: str                             # Who sent the rating
    responseId: str                         # Which response is being rated
    rating: int                             # 1..5
    feedback: Optional[str] = None          # Optional text commentary

class Citation(BaseModel):
    title: str                              # Display name (friendly text; usually filename)
    source: str                             # Source URI (S3 path or other)

class ChatResponse(BaseModel):
    response: str                           # Final visible assistant text
    sessionId: str                          # Session ID to continue a conversation
    citations: List[Citation]               # List of sources used
    userId: str                             # Echo back the caller's id
    followUpQuestions: Optional[List[str]] = None  # 3 suggestions for next steps

# -----------------------------------------------------------------------------
# Prompt templates
# -----------------------------------------------------------------------------
# NOTE: These steer the orchestrator and specialists. No chain-of-thought should leak.
ORCHESTRATOR_PROMPT = """You are an intelligent assistant for the iECHO platform focused on TB and Agriculture.

Your job is to analyze the user's query and provide a helpful response by calling the appropriate specialist tool.

Analysis tools (use first if needed):
- image_reader: Analyze images to understand visual content

Specialist tools (choose one for final response):
- tb_specialist: Handles ALL tuberculosis and health-related questions
- agriculture_specialist: Handles ALL agriculture and farming topics
- reject_handler: Politely declines unrelated queries

CRITICAL GUARDRAILS:
1. IMAGE ANALYSIS RULES:
   - If query contains "Image path:", use image_reader FIRST to analyze the image
   - After image analysis, evaluate BOTH the original text query AND image content together
   - If image shows unrelated content (pets, random objects, people, landscapes, etc.) AND text query is generic ("what is in the image?", "describe this", "what do you see?"), use reject_handler
   - Only proceed to specialists if image content OR text query relates to TB/agriculture/health

2. TEXT QUERY VALIDATION:
   - Reject queries asking for: personal advice, entertainment, general knowledge unrelated to TB/agriculture
   - Reject requests for: creative writing, jokes, games, programming help, financial advice
   - Reject inappropriate content: offensive language, harmful instructions, illegal activities

3. ROUTING LOGIC:
   - TB/Health-related: symptoms, diagnosis, treatment, prevention, patient care, nutrition, public health → tb_specialist
   - Agriculture-related: crops, farming, irrigation, soil, food safety, livestock → agriculture_specialist
   - Everything else → reject_handler

4. OUTPUT RULES:
   - Always end with exactly one specialist tool call for the final response
   - NEVER show tool calls, reasoning, or internal processes to the user
   - Only return the clean, helpful response from the specialist
"""

# Specialist prompts ask the agent to ALWAYS use kb_search first (tool forcing by instruction).
TB_AGENT_PROMPT = """You are a TB and Health specialist. ALWAYS use the kb_search tool to find information, then provide brief, direct answers about:
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
# Utility helpers
# -----------------------------------------------------------------------------
def count_tokens(text: str) -> int:
    """
    Return a coarse token estimate using Nova's ~6 characters/token heuristic.
    Used to enforce a simple per-request prompt length limit.
    """
    return len(text) // 6

def filter_thinking_tags(text: str) -> str:
    """
    Redact any leaked chain-of-thought markers before returning text to users.
    - Removes <thinking>...</thinking>, stray thinking open/close tags,
      single-line "Action: ..." traces, and decision tokens like <TB>, <AG>, <REJECT>.
    """
    import re
    text = re.sub(r'<thinking>.*?</thinking>', '', text, flags=re.DOTALL)
    text = re.sub(r'</?thinking[^>]*>', '', text)
    text = re.sub(r'Action: [^\n]*\n?', '', text)
    text = re.sub(r'^\s*<(TB|AG|REJECT)>\s*\n*', '', text)
    return text.strip()

def query_knowledge_base(query: str, topic: str, conversation_history: List[str]) -> Dict:
    """
    Compose a RetrieveAndGenerate request against the configured Bedrock KB and model profile.
    - Incorporates minimal recent context to improve grounding.
    - Returns the raw service response on success, or a friendly text error stub on failure.
    """
    try:
        # Prefer to inject the most recent user message for contextual grounding
        context_query = query
        if conversation_history:
            recent_user = [h for h in conversation_history[-4:] if h.startswith('User:')]
            if recent_user:
                context_query = f"Previous question: {recent_user[-1]}\nCurrent question: {query}"
            else:
                context_query = f"Context: {' '.join(conversation_history[-2:])}\n\nCurrent question: {query}"

        # Build RnG payload with KB + Nova Lite inference profile
        request_config = {
            'input': {'text': context_query},
            'retrieveAndGenerateConfiguration': {
                'type': 'KNOWLEDGE_BASE',
                'knowledgeBaseConfiguration': {
                    'knowledgeBaseId': KNOWLEDGE_BASE_ID,
                    'modelArn': f'arn:aws:bedrock:{os.environ.get("AWS_REGION", "us-west-2")}:{AWS_ACCOUNT_ID}:inference-profile/us.amazon.nova-lite-v1:0'
                }
            }
        }
        # Call Bedrock Agent Runtime
        resp = bedrock_agent_runtime.retrieve_and_generate(**request_config)
        return resp
    except Exception as e:
        # On exception, return a user-visible fallback text; log at server side
        logger.error(f"KB query error: {e}")
        return {'output': {'text': f"I’m having trouble accessing the knowledge base right now. Error: {str(e)}"}}

# -----------------------------------------------------------------------------
# Streaming support helpers
# -----------------------------------------------------------------------------
class ToolChoiceTracker:
    """
    Keeps track of which SPECIALIST tool ran last (tb/agri/reject).
    Orchestrator may use analysis tools like image_reader first; we ignore those here.
    """
    def __init__(self):
        self.name: Optional[str] = None
    def set(self, name: Optional[str]):
        if name and name in ['tb_specialist', 'agriculture_specialist', 'reject_handler']:
            self.name = name

def make_streaming_callback(on_tool_start: Optional[Callable[[str], None]] = None):
    """
    Build a Strands callback that:
    - Swallows reasoning/error events (we don't forward them to the user).
    - Notifies on_tool_start when a tool invocation starts (to capture which specialist ran).
    - Does NOT emit content; content is forwarded from the main streaming loop.
    """
    def _handler(**kwargs):
        # Suppress non-user-visible signals
        if kwargs.get("reasoning") or kwargs.get("force_stop") or kwargs.get("error") or kwargs.get("exception"):
            return
        # Capture tool identity as soon as it starts
        current_tool_use = kwargs.get("current_tool_use")
        if current_tool_use and on_tool_start:
            name = current_tool_use.get("name")
            if name:
                on_tool_start(name)
    return _handler

# -----------------------------------------------------------------------------
# Specialists & tools (agents-as-tools pattern)
# -----------------------------------------------------------------------------
def make_kb_tool(topic: str, citations_sink: list, conversation_history: List[str]):
    """
    Factory for a kb_search tool bound to a domain topic.
    - Runs Bedrock RnG, extracts deduplicated citations into citations_sink.
    - Returns only the textual answer; citations are captured side-channel.
    """
    @tool
    async def kb_search(user_query: str) -> str:
        """Search iECHO Knowledge Base for this specialty and return a concise answer with citations tracked internally."""
        logger.info(f"KB lookup topic='{topic}' for query='{user_query[:120]}'")
        kb_response = query_knowledge_base(user_query, topic, conversation_history)

        # Reset and rebuild the citation list on every call
        citations_sink.clear()
        seen_sources = set()

        # Bedrock response shape: citations[] -> retrievedReferences[] with location & content
        for citation in kb_response.get('citations', []):
            for reference in citation.get('retrievedReferences', []):
                content_text = reference.get('content', {}).get('text', '')
                doc_uri = reference.get('location', {}).get('s3Location', {}).get('uri', '')
                title = doc_uri.split('/')[-1].replace('.pdf', '') if doc_uri else 'Document'
                # Enforce uniqueness based on source URI to avoid duplicates
                if doc_uri and doc_uri not in seen_sources:
                    seen_sources.add(doc_uri)
                    citations_sink.append({
                        'title': title, 'source': doc_uri, 'excerpt': content_text
                    })
        # Return only visible text
        return kb_response['output']['text']
    return kb_search

def build_specialists(conversation_history: List[str]):
    """
    Instantiate the two specialist Agents (TB & Agriculture):
    - Each gets its own kb_search tool bound to a citations buffer.
    - Optionally attach a conversation manager for short-term memory.
    - Use Nova Lite inference profile for both.
    """
    tb_citations: List[Dict] = []
    agri_citations: List[Dict] = []

    # Choose a conversation manager strategy based on availability
    if SlidingWindowConversationManager is not None:
        conv_mgr = SlidingWindowConversationManager(window_size=20, should_truncate_results=True)
    elif SummarizingConversationManager is not None:
        conv_mgr = SummarizingConversationManager(preserve_recent_messages=10, summary_ratio=0.3)
    else:
        conv_mgr = None

    # Compose tool arrays per specialist
    tb_tools = [make_kb_tool("tuberculosis", tb_citations, conversation_history)]
    agri_tools = [make_kb_tool("agriculture", agri_citations, conversation_history)]
    
    # TB specialist Agent
    tb_agent = Agent(
        system_prompt=TB_AGENT_PROMPT,
        tools=tb_tools,
        model=f"arn:aws:bedrock:{os.environ.get('AWS_REGION', 'us-west-2')}:{AWS_ACCOUNT_ID}:inference-profile/us.amazon.nova-lite-v1:0",
        conversation_manager=conv_mgr,
    )

    # Agriculture specialist Agent
    agri_agent = Agent(
        system_prompt=AGRICULTURE_AGENT_PROMPT,
        tools=agri_tools,
        model=f"arn:aws:bedrock:{os.environ.get('AWS_REGION', 'us-west-2')}:{AWS_ACCOUNT_ID}:inference-profile/us.amazon.nova-lite-v1:0",
        conversation_manager=conv_mgr,
    )

    # Return both the Agent and its side-channel citations buffer
    return {
        "tb": (tb_agent, tb_citations),
        "agri": (agri_agent, agri_citations),
    }

def build_orchestrator_tools(conversation_history: List[str]):
    """
    Build the list of tools visible to the Orchestrator:
    1) image_reader (if available)
    2) tb_specialist
    3) agriculture_specialist
    4) reject_handler
    Also returns a getter for the last citations of whichever specialist ran, and a tiny
    context dict reserved for future image analysis storage (unused hook).
    """
    specialists = build_specialists(conversation_history)

    # Placeholder hook to store image analysis summaries if desired
    context = {'image_analysis': None}
    
    async def _run_agent_and_capture(agent: Agent, query: str) -> str:
        """
        Utility to stream a specialist Agent and return only visible text.
        - Filters out reasoning/error events.
        - Strips any leaked <thinking> tags before returning.
        """
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

    # Wrap each specialist Agent as a @tool callable that returns only user-visible text
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
    async def reject_handler(user_query: str) -> str:
        """Politely decline queries unrelated to TB, agriculture, or health topics."""
        return "I'm sorry, but I can only help with questions related to tuberculosis (TB), agriculture, and related health topics. If you have an image related to TB or agriculture, please describe what you'd like to know about it in your question."

    def get_last_citations(tool_name: Optional[str]):
        """
        Helper closure returning the last citations buffer for the named specialist.
        - If reject_handler or None, returns [].
        """
        mapping = {
            "tb_specialist": specialists["tb"][1],
            "agriculture_specialist": specialists["agri"][1],
        }
        return mapping.get(tool_name, [])

    # Assemble orchestrator tool list in analysis → specialist order
    orchestrator_tools = []
    if image_reader:
        orchestrator_tools.append(image_reader)  # Analysis tool (optional)
    orchestrator_tools.extend([tb_specialist, agriculture_specialist, reject_handler])
    
    # Return: (tool list, citations getter, image hook)
    return orchestrator_tools, get_last_citations, context

# -----------------------------------------------------------------------------
# Follow-up question generation (uses a lightweight Agent call)
# -----------------------------------------------------------------------------
async def generate_follow_up_questions(response_text: str, original_query: str, conversation_history: List[str]) -> List[str]:
    """
    Produce up to 3 concise, relevant follow-up questions:
    - Constructs a prompt with the original query, current response, and recent history.
    - Streams text from Nova Lite, filters out reasoning segments, parses into lines.
    - Falls back to sensible defaults on errors.
    """
    try:
        # Build compact context for the prompt
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

        # Minimal Agent; no tools or conv manager needed
        agent = Agent(
            system_prompt="You are a helpful assistant that generates relevant follow-up questions. Be concise and practical.",
            model=f"arn:aws:bedrock:{os.environ.get('AWS_REGION', 'us-west-2')}:{AWS_ACCOUNT_ID}:inference-profile/us.amazon.nova-lite-v1:0"
        )

        buf: List[str] = []
        async for ev in agent.stream_async(prompt):
            # Suppress model-internal signals
            if ev.get("reasoning") or ev.get("force_stop") or ev.get("error") or ev.get("exception"):
                continue
            if "data" in ev:
                chunk = ev['data']
                # Prevent leaking any thinking tokens
                if '<thinking>' not in chunk and '</thinking>' not in chunk:
                    buf.append(chunk)

        # Parse line by line and retain question-like strings only
        lines = "".join(buf).strip().split('\n')
        questions = []
        for line in lines:
            line = line.strip()
            if line and '?' in line and len(line) > 10:
                # Strip any accidental bullets/numbers
                questions.append(line.strip('- *123456789. '))

        # Ensure exactly 3 by padding with defaults (used if LLM returned fewer)
        defaults = [
            "Would you like a step-by-step plan?",
            "Do you want references or further reading?",
            "Should I tailor this to a specific setting?"
        ]
        while len(questions) < 3 and defaults:
            questions.append(defaults.pop(0))

        return questions[:3]
    except Exception as e:
        # Fallback in case model call fails
        logger.error(f"Follow-up generation error: {e}")
        return [
            "Would you like a step-by-step plan?",
            "Do you want references or further reading?",
            "Should I tailor this to a specific setting?"
        ]

# -----------------------------------------------------------------------------
# Orchestrator (Streaming NDJSON)
# -----------------------------------------------------------------------------
async def run_orchestrator_agent(query: str, session_id: str, user_id: str, image: Optional[str] = None):
    """
    Streaming pipeline:
      * Garbage-collects stale sessions (TTL 1h).
      * Optionally writes a base64 image to a temp file & hints orchestrator with "Image path: ..."
      * Builds orchestrator Agent with tools and a callback to capture chosen specialist.
      * Iterates over stream_async(...) events and yields NDJSON:
          - {"type":"content","data":"..."}     visible text chunks
          - {"type":"thinking_*"}               optional markers for client UI (not required)
          - {"type":"error","data":"..."}       timeout message
      * On completion, updates session history, logs, and yields a final JSON object
        containing the full response, citations, ids, and follow-up questions.
    """
    # ---- TTL cleanup: remove sessions idle for > 3600s ----
    now = time()
    for sid, data in list(conversation_sessions.items()):
        if now - data['last_access'] > 3600:
            del conversation_sessions[sid]

    # Session activation/update
    sess = conversation_sessions[session_id]
    sess['last_access'] = now
    history = sess['history']
    
    # ---- Optional base64 image handling (writes to a temp file) ----
    temp_path = None
    if image:
        import tempfile
        import base64
        # Basic magic header detection; supports PNG/JPEG/GIF/WEBP; defaults to .png
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
            ext = '.png'  # conservative default
        
        temp_fd, temp_path = tempfile.mkstemp(suffix=ext)
        try:
            with os.fdopen(temp_fd, 'wb') as f:
                f.write(img_data)
            os.chmod(temp_path, 0o644)              # readable by the process
            # Prepend a hint so the orchestrator knows to invoke image_reader first
            query = f"Image path: {temp_path}\n{query}"
        except Exception as e:
            if temp_path and os.path.exists(temp_path):
                os.unlink(temp_path)                # best-effort cleanup
            raise e
    
    # Build tools (image_reader + specialists + reject)
    tools, get_last_citations, image_context = build_orchestrator_tools(history)

    # Choose a conversation manager for the orchestrator, mirroring specialists
    if SlidingWindowConversationManager is not None:
        orch_mgr = SlidingWindowConversationManager(window_size=20, should_truncate_results=True)
    elif SummarizingConversationManager is not None:
        orch_mgr = SummarizingConversationManager(preserve_recent_messages=10, summary_ratio=0.3)
    else:
        orch_mgr = None

    # Incorporate last few messages directly in the system prompt for continuity
    context_prompt = ORCHESTRATOR_PROMPT
    if history:
        recent = "\n".join(history[-4:])
        context_prompt += f"\n\nConversation history:\n{recent}"

    # Track tool selection without emitting content
    tracker = ToolChoiceTracker()
    cb = make_streaming_callback(on_tool_start=tracker.set)

    # Prepare orchestrator Agent with the toolset and callback
    input_content = query
    orchestrator = Agent(
        system_prompt=context_prompt,
        tools=tools,
        model=f"arn:aws:bedrock:{os.environ.get('AWS_REGION', 'us-west-2')}:{AWS_ACCOUNT_ID}:inference-profile/us.amazon.nova-lite-v1:0",
        conversation_manager=orch_mgr,
        callback_handler=cb
    )

    # Streaming state
    full_text = ""                # Collects all visible content to store in history and final payload
    in_thinking = False           # Tracks whether we're inside a <thinking> block
    
    start_time = time()
    timeout_seconds = 25          # Safety net to avoid runaway streaming

    # ---- Main stream loop: forward user-visible text as NDJSON ----
    async for ev in orchestrator.stream_async(input_content):
        # Cooperative timeout: stop politely if exceeded
        if time() - start_time > timeout_seconds:
            yield json.dumps({"type": "error", "data": "Request timeout. Please try again."}) + "\n"
            return
            
        # Suppress non-user-visible frames
        if ev.get("reasoning") or ev.get("force_stop") or ev.get("error") or ev.get("exception"):
            continue

        # Track tool usage start; useful for logging & citation lookup
        if 'tool' in ev and ev.get('phase') in ('start', 'call', 'begin'):
            tracker.set(ev.get('tool'))

        # Emit visible data
        if "data" in ev:
            chunk = ev["data"]
            if not chunk.strip():
                continue  # skip empty tokens

            # The following logic tolerates thinking tags spilling across token boundaries:
            if chunk == '<thinking' or chunk.startswith('<thinking'):
                in_thinking = True
                # Optional UI signal; the client can choose to ignore these
                yield json.dumps({"type": "thinking_start"}) + "\n"
                continue
            elif chunk == '>' and in_thinking and not full_text:
                # Handles '<thinking' + '>' split across chunks (no content yet)
                continue
            elif '</' in chunk and in_thinking:
                # Closing tag may include tail content before '</'
                before_tag = chunk.split('</')[0]
                if before_tag:
                    yield json.dumps({"type": "thinking", "data": before_tag}) + "\n"
                in_thinking = False
                yield json.dumps({"type": "thinking_end"}) + "\n"
                continue
            elif chunk in ['</thinking', 'thinking', '>', '>\n'] and not in_thinking:
                # Ignore orphan tag fragments outside thinking context
                continue
                
            # Route into separate streams depending on state
            if in_thinking:
                # Client may hide this stream to avoid showing reasoning
                yield json.dumps({"type": "thinking", "data": chunk}) + "\n"
            else:
                full_text += chunk
                yield json.dumps({"type": "content", "data": chunk}) + "\n"

    # One final guard to strip any leftover tags
    full_text = filter_thinking_tags(full_text)

    # Persist conversation turns for continuity in subsequent requests
    history.append(f"User: {query}")
    history.append(f"Assistant: {full_text}")

    # Gather citations from whichever specialist ran
    chosen_tool = tracker.name
    citations = get_last_citations(chosen_tool)

    # Generate a response ID and follow-ups (non-streaming call under the hood)
    response_id = str(uuid4())
    followups = await generate_follow_up_questions(full_text, query, history)

    # Build a concise log message; redact image payloads
    log_query = query
    if image_context['image_analysis']:
        log_query = f"Query: {query} | Image: {image_context['image_analysis'][:200]}..."
    elif image:
        log_query = f"[IMAGE_PROVIDED] {query}"
    
    log_message = (
        f"Chat complete - User ID: {user_id}, Session ID: {session_id}, Response ID: {response_id}, "
        f"SelectedAgent: {chosen_tool or 'unknown'}, Query: {log_query}, Response: {full_text}, "
        f"Citations: {json.dumps(citations) if citations else '[]'}"
    )
    logger.info(log_message)
    log_to_cloudwatch(log_message)

    # Best-effort cleanup of any temp image file
    if temp_path and os.path.exists(temp_path):
        try:
            os.unlink(temp_path)
        except:
            pass
    
    # Final NDJSON message: structured payload for the client
    yield json.dumps({
        "response": full_text,
        "citations": [{"title": c.get("title", ""), "source": c.get("source", "")} for c in citations],
        "sessionId": session_id,
        "responseId": response_id,
        "userId": user_id,
        "followUpQuestions": followups
    }) + "\n"

# -----------------------------------------------------------------------------
# Orchestrator (Non-streaming, single-shot)
# -----------------------------------------------------------------------------
async def run_orchestrator_once(query: str, history: List[str], image: Optional[str] = None):
    """
    Non-streaming variant:
    - Creates the same orchestrator Agent and tools, but collects all output first.
    - If a base64 image is provided, writes it to a temp file and prepends "Image path: ..."
    - Returns (text, citations, chosen_tool_name).
    """
    temp_path = None
    if image:
        import tempfile
        import base64
        # Same header-detection logic as streaming path
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
            ext = '.png'
        
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
    
    # Hint orchestrator to run image_reader first if a temp image exists
    if temp_path:
        query = f"Image path: {temp_path}\n{query}"

    # Conversation manager selection mirrors the streaming path
    if SlidingWindowConversationManager is not None:
        orch_mgr = SlidingWindowConversationManager(window_size=20, should_truncate_results=True)
    elif SummarizingConversationManager is not None:
        orch_mgr = SummarizingConversationManager(preserve_recent_messages=10, summary_ratio=0.3)
    else:
        orch_mgr = None

    # Capture specialist name using the same callback pattern
    tracker = ToolChoiceTracker()
    cb = make_streaming_callback(on_tool_start=tracker.set)

    orchestrator = Agent(
        system_prompt=ORCHESTRATOR_PROMPT,
        tools=tools,
        model=f"arn:aws:bedrock:{os.environ.get('AWS_REGION', 'us-west-2')}:{AWS_ACCOUNT_ID}:inference-profile/us.amazon.nova-lite-v1:0",
        conversation_manager=orch_mgr,
        callback_handler=cb
    )

    # Run and accumulate visible chunks only
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
    
    # Cleanup temp file if we created one
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
    """
    Basic liveness endpoint for K8s probes and manual checks.
    Returns current UTC time for quick latency sanity checks.
    """
    return {
        "status": "healthy",
        "service": "iECHO RAG Chatbot API",
        "timestamp": datetime.now(timezone.utc).isoformat()
    }

@app.post('/chat')
async def chat(request: ChatRequest):
    """
    Non-streaming chat:
    - Validates inputs (empty, token length, image size, KB configured).
    - Creates/extends a session, runs the orchestrator once, then returns
      response text, citations, session/response IDs, and 3 follow-ups.
    """
    try:
        # ---- Basic input validation ----
        if not request.query.strip():
            raise HTTPException(status_code=400, detail="Query cannot be empty")
        token_count = count_tokens(request.query)
        if token_count > 150:
            # Protects against very long prompts; adjust based on your model constraints
            raise HTTPException(status_code=400, detail=f"Query too long. {token_count} tokens provided, maximum 150 tokens allowed.")
        if request.image and len(request.image) > 5 * 1024 * 1024:
            # Simple guardrail against oversized base64 input
            raise HTTPException(status_code=413, detail="Image too large. Maximum size is 5MB.")
        if not KNOWLEDGE_BASE_ID:
            # Required to perform RetrieveAndGenerate
            raise HTTPException(status_code=500, detail="Knowledge Base not configured")

        # ---- Session handling ----
        session_id = request.sessionId or str(uuid4())
        response_id = str(uuid4())
        sess = conversation_sessions[session_id]
        sess['last_access'] = time()
        history = sess['history']

        # ---- Run orchestrator and update history ----
        response_text, citations, chosen_tool = await run_orchestrator_once(request.query, history, request.image)
        history.append(f"User: {request.query}")
        history.append(f"Assistant: {response_text}")

        # ---- Follow-ups + logging ----
        followups = await generate_follow_up_questions(response_text, request.query, history)

        log_query = request.query
        if request.image:
            log_query = f"[IMAGE_PROVIDED] {request.query}"
        
        log_message = (
            f"Chat complete - User: {request.userId}, Session ID: {session_id}, Response ID: {response_id}, "
            f"SelectedAgent: {chosen_tool or 'unknown'}, Query: {log_query}, Response: {response_text}, "
            f"Citations: {json.dumps(citations) if citations else '[]'}"
        )
        logger.info(log_message)
        log_to_cloudwatch(log_message)

        # ---- Response payload ----
        return {
            "response": response_text,
            "citations": [{"title": c.get("title", ""), "source": c.get("source", "")} for c in citations],
            "sessionId": session_id,
            "responseId": response_id,
            "userId": request.userId,
            "followUpQuestions": followups
        }

    except Exception as e:
        # Collect rich context for triage
        error_details = {
            'error_type': type(e).__name__,
            'error_message': str(e),
            'endpoint': '/chat',
            'user_id': request.userId,
            'session_id': request.sessionId,
            'query_length': len(request.query) if request.query else 0,
            'has_image': bool(request.image)
        }
        log_to_cloudwatch("Chat endpoint error", "ERROR", error_details)
        logger.error(f"Error in chat endpoint: {str(e)}")
        # Relay a bounded error message to client
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")

@app.post('/chat-stream')
async def chat_stream(request: ChatRequest):
    """
    Streaming chat:
    - Same validation as /chat.
    - Returns an NDJSON stream with incremental "content" chunks and a final JSON object.
    - The client should read line-by-line and stop on the final aggregate object.
    """
    try:
        # ---- Same validations as non-streaming ----
        if not request.query.strip():
            raise HTTPException(status_code=400, detail="Query cannot be empty")
        token_count = count_tokens(request.query)
        if token_count > 150:
            raise HTTPException(status_code=400, detail=f"Query too long. {token_count} tokens provided, maximum 150 tokens allowed.")
        if request.image and len(request.image) > 5 * 1024 * 1024:
            raise HTTPException(status_code=413, detail="Image too large. Maximum size is 5MB.")
        if not KNOWLEDGE_BASE_ID:
            raise HTTPException(status_code=500, detail="Knowledge Base not configured")

        # New or continuing session; run orchestrator generator directly
        session_id = request.sessionId or str(uuid4())
        return StreamingResponse(
            run_orchestrator_agent(request.query, session_id, request.userId, request.image),
            media_type="application/x-ndjson"  # NDJSON content type (line-delimited JSON)
        )

    except Exception as e:
        # Log and convert to HTTP 500
        error_details = {
            'error_type': type(e).__name__,
            'error_message': str(e),
            'endpoint': '/chat-stream',
            'user_id': request.userId,
            'session_id': request.sessionId,
            'query_length': len(request.query) if request.query else 0,
            'has_image': bool(request.image)
        }
        log_to_cloudwatch("Chat-stream endpoint error", "ERROR", error_details)
        logger.error(f"Error in chat-stream endpoint: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")

@app.post('/feedback')
async def submit_feedback(request: FeedbackRequest):
    """
    Store a feedback item in DynamoDB:
    - Validates rating range.
    - Adds timestamp and generated feedbackId.
    - Returns a short success message + feedbackId.
    """
    try:
        # Input validation
        if not (1 <= request.rating <= 5):
            raise HTTPException(status_code=400, detail="Rating must be between 1 and 5")

        # DynamoDB put
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

        # Log & return
        log_message = (f"Feedback submitted - User: {request.userId}, Response ID: {request.responseId}, "
                       f"Rating: {request.rating}, Feedback: {request.feedback or 'None'}, "
                       f"Feedback ID: {item['feedbackId']}")
        logger.info(log_message)
        log_to_cloudwatch(log_message)

        return {"message": "Feedback submitted successfully", "feedbackId": item['feedbackId']}

    except Exception as e:
        # Structured error log for ops
        error_details = {
            'error_type': type(e).__name__,
            'error_message': str(e),
            'endpoint': '/feedback',
            'user_id': request.userId,
            'response_id': request.responseId,
            'rating': request.rating
        }
        log_to_cloudwatch("Feedback endpoint error", "ERROR", error_details)
        logger.error(f"Error in feedback endpoint: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")

@app.get('/documents')
async def list_documents():
    """
    Enumerate up to 100 objects under 'processed/' in the KB's S3 data source bucket.
    Steps:
      1) List data sources for the configured KB.
      2) Get details of the first data source (assumes one data source).
      3) Parse bucket ARN -> bucket name.
      4) List objects with Prefix='processed/'.
    Returns: {documents: [{key,name,size,lastModified}], count}
    """
    try:
        if not KNOWLEDGE_BASE_ID:
            raise HTTPException(status_code=500, detail="Knowledge Base not configured")

        # Discover KB data source & its S3 config
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
        bucket_name = s3_cfg['bucketArn'].split(':')[-1]  # Extract the bucket name from arn:aws:s3:::bucket

        # List recent processed docs (cap at 100 for response size)
        resp = s3.list_objects_v2(Bucket=bucket_name, Prefix='processed/', MaxKeys=100)
        docs = []
        for obj in resp.get('Contents', []):
            if obj['Key'] != 'processed/':  # Skip the prefix object
                docs.append({
                    'key': obj['Key'],
                    'name': obj['Key'].replace('processed/', ''),
                    'size': obj['Size'],
                    'lastModified': obj['LastModified'].isoformat()
                })
        return {"documents": docs, "count": len(docs)}

    except Exception as e:
        # Errors could be due to IAM, KB not set, S3 listing issues, etc.
        error_details = {
            'error_type': type(e).__name__,
            'error_message': str(e),
            'endpoint': '/documents',
            'kb_id': KNOWLEDGE_BASE_ID
        }
        log_to_cloudwatch("Documents endpoint error", "ERROR", error_details)
        logger.error(f"Error in documents endpoint: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")

@app.get('/document-url/{path:path}')
async def get_document_url(path: str):
    """
    Generate a pre-signed URL (1 hour) for an S3 object:
    - Expects path as "s3://bucket/key".
    - Useful for downloading processed PDFs from the frontend.
    """
    try:
        if not path.startswith('s3://'):
            raise HTTPException(status_code=400, detail="Invalid S3 URL format")
        parts = path.replace('s3://', '').split('/', 1)
        bucket = parts[0]
        key = parts[1] if len(parts) > 1 else ''
        url = s3.generate_presigned_url('get_object', Params={'Bucket': bucket, 'Key': key}, ExpiresIn=3600)
        return {"url": url}
    except Exception as e:
        # Provide enough context to debug malformed paths or IAM issues
        error_details = {
            'error_type': type(e).__name__,
            'error_message': str(e),
            'endpoint': '/document-url',
            'path': path
        }
        log_to_cloudwatch("Document URL generation error", "ERROR", error_details)
        logger.error(f"Error generating presigned URL: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Failed to generate document URL: {str(e)}")

@app.get('/status')
async def get_status():
    """
    Lightweight operational status:
    - knowledgeBaseConfigured: True if KNOWLEDGE_BASE_ID is non-empty
    - documentsConfigured: mirrors KB presence
    - feedbackConfigured: True if FEEDBACK_TABLE_NAME is set (string truthiness)
    """
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
    # Local dev entry point. In Kubernetes, uvicorn is typically launched by container CMD.
    port = int(os.environ.get('PORT', 8000))
    uvicorn.run(app, host='0.0.0.0', port=port)
