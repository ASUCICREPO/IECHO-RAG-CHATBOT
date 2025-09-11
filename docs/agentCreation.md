# Adding a New Specialist Agent

## Overview
This guide explains how to add a new specialist agent (e.g., `nutrition_specialist`) to the iECHO RAG Chatbot without modifying infrastructure, models, or services.

## Prerequisites
- Access to the application code (`backend/docker/app/app.py`)
- Understanding of the existing agent architecture
- Knowledge base content relevant to the new specialist domain

## Implementation Steps

### Step 1: Define the Specialist Prompt

Add a new prompt constant near the existing agent prompts:

```python
NUTRITION_AGENT_PROMPT = """You are a Nutrition specialist. ALWAYS use the kb_search tool to find information, then provide brief, direct answers about:
- Food safety, nutrition guidelines, supplementation
- Diet planning for TB care and agricultural workers
- Post-harvest handling and contamination prevention
Keep responses concise (2–3 sentences). Do NOT reveal internal reasoning.
If image analysis results are provided in the query, use them as additional context.
"""
```

### Step 2: Update the Orchestrator Prompt

Modify the `ORCHESTRATOR_PROMPT` to include the new specialist. Add these lines in the exact locations shown:

**In the Specialist Tools Section (after `agriculture_specialist` line):**
```
- nutrition_specialist: Handles ALL nutrition and food safety topics
```

**In the Routing Logic Section (after the Agriculture line):**
```
- Nutrition-related: food safety, nutrition guidelines, diet in TB care → nutrition_specialist
```

> **Important:** Keep all existing guardrails and rules intact when making these additions.

### Step 3: Extend the `build_specialists()` Function

Add the new specialist to the function that creates all specialist agents:

> **Note:** Keep the existing `tb_agent` and `agri_agent` creation blocks as-is; add `nutrition_agent` alongside them and return all three.

```python
def build_specialists(conversation_history: List[str]):
    # Existing citations
    tb_citations: List[Dict] = []
    agri_citations: List[Dict] = []
    nutrition_citations: List[Dict] = []  # NEW
    
    # Conversation manager setup (keep existing logic)
    if SlidingWindowConversationManager is not None:
        conv_mgr = SlidingWindowConversationManager(window_size=20, should_truncate_results=True)
    elif SummarizingConversationManager is not None:
        conv_mgr = SummarizingConversationManager(preserve_recent_messages=10, summary_ratio=0.3)
    else:
        conv_mgr = None
    
    # Tools setup
    tb_tools = [make_kb_tool("tuberculosis", tb_citations, conversation_history)]
    agri_tools = [make_kb_tool("agriculture", agri_citations, conversation_history)]
    nutrition_tools = [make_kb_tool("nutrition", nutrition_citations, conversation_history)]  # NEW
    
    # Agent creation (add alongside existing agents)
    nutrition_agent = Agent(  # NEW
        system_prompt=NUTRITION_AGENT_PROMPT,
        tools=nutrition_tools,
        model=f"arn:aws:bedrock:{os.environ.get('AWS_REGION', 'us-west-2')}:{AWS_ACCOUNT_ID}:inference-profile/us.amazon.nova-lite-v1:0",
        conversation_manager=conv_mgr,
    )
    
    return {
        "tb": (tb_agent, tb_citations),
        "agri": (agri_agent, agri_citations),
        "nutrition": (nutrition_agent, nutrition_citations),  # NEW
    }
```

> **Topic String:** Use a topic string that reflects your KB organization (e.g., "nutrition", "food_safety") in `make_kb_tool()`.

### Step 4: Extend the `build_orchestrator_tools()` Function

Add the new specialist tool to the orchestrator's available tools:

> **Note:** Leave `tb_specialist` and `agriculture_specialist` wrappers unchanged to avoid accidental edits.

```python
def build_orchestrator_tools(conversation_history: List[str]):
    specialists = build_specialists(conversation_history)
    context = {'image_analysis': None}
    
    # Add new specialist tool (alongside existing ones)
    @tool
    async def nutrition_specialist(user_query: str) -> str:  # NEW
        """Nutrition specialist agent: food safety, nutrition guidelines, diet in TB care."""
        agent, _ = specialists["nutrition"]
        return await _run_agent_and_capture(agent, user_query)
    
    # Update citations mapping
    def get_last_citations(tool_name: Optional[str]):
        mapping = {
            "tb_specialist": specialists["tb"][1],
            "agriculture_specialist": specialists["agri"][1],
            "nutrition_specialist": specialists["nutrition"][1],  # NEW
        }
        return mapping.get(tool_name, [])
    
    # Register tools with orchestrator
    orchestrator_tools = []
    if image_reader:
        orchestrator_tools.append(image_reader)
    
    orchestrator_tools.extend([
        tb_specialist,
        agriculture_specialist,
        nutrition_specialist,  # NEW
        reject_handler
    ])
    
    return orchestrator_tools, get_last_citations, context
```

### Step 5: Update ToolChoiceTracker

**Critical:** Include the new tool in `ToolChoiceTracker` to ensure proper routing and citations in streaming mode:

```python
class ToolChoiceTracker:
    def __init__(self):
        self.name: Optional[str] = None
    def set(self, name: Optional[str]):
        if name and name in [
            'tb_specialist',
            'agriculture_specialist',
            'nutrition_specialist',  # NEW
            'reject_handler'
        ]:
            self.name = name
```

> **Without this update:** The router won't record `nutrition_specialist` and your citations may come back empty in streaming mode.

## Verification Checklist

Before deploying your changes, ensure you have completed all steps:

- [ ] **Added new prompt constant** (e.g., `NUTRITION_AGENT_PROMPT`)
- [ ] **Updated `ORCHESTRATOR_PROMPT`** with new tool and routing logic
- [ ] **Extended `build_specialists()`** with citations list, tools, and Agent
- [ ] **Extended `build_orchestrator_tools()`** with specialist tool, citations mapping, and tool registration
- [ ] **Updated `ToolChoiceTracker.set()`** to include `nutrition_specialist`
- [ ] **Tested locally** to ensure the new agent responds correctly
- [ ] **Verified knowledge base** contains relevant content for the new domain

## Testing the New Agent

1. **Deploy the updated application**
2. **Send test queries** related to the new specialist domain
3. **Verify routing** - check logs to confirm the orchestrator selects the correct specialist
4. **Success criteria:** Logs show `SelectedAgent: nutrition_specialist` and citations array is non-empty
5. **Validate responses** - ensure the agent provides relevant, accurate information
6. **Check citations** - confirm knowledge base citations are properly returned

## Notes

- **No infrastructure changes required** - this is purely an application-level modification
- **Knowledge base content** should include relevant documents for the new specialist domain
- **Model and service configurations** remain unchanged
- **Existing agents** are not affected by adding new specialists

## Troubleshooting

**Agent not being selected:**
- Check the orchestrator prompt routing logic
- Verify the tool is properly registered in `orchestrator_tools`

**No citations returned:**
- Ensure the knowledge base contains relevant content
- Check the topic parameter in `make_kb_tool()`
- Verify `ToolChoiceTracker` includes the new specialist

**Errors during agent execution:**
- Verify the agent prompt syntax
- Check that all required imports are available