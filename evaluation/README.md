# iECHO RAG Chatbot Evaluation

This directory contains scripts for evaluating the iECHO RAG chatbot system using AWS Bedrock model evaluation.


## Files

- `collect_model_dataset.py` - Generate model evaluation dataset from API responses

- `requirements.txt` - Python dependencies
- `model_evaluation_dataset.jsonl` - Generated evaluation dataset (example)

## Setup

1. Install dependencies:
```bash
pip install -r requirements.txt
```

2. Update API URL in scripts:
```python
API_BASE_URL = "https://your-actual-api-gateway-url.execute-api.region.amazonaws.com/prod"
```

## Usage

### Generate Evaluation Dataset

```bash
python collect_model_dataset.py
```

**Features:**
- Calls live streaming API with test questions (5 TB + 5 Agriculture)
- Compares actual responses against expert ground truth
- Generates Bedrock-compatible JSONL format
- Modular design - easily add more questions/categories

**Adding Questions:**
```python
TEST_PROMPTS = {
    "TB": [
        "What are the main symptoms of tuberculosis?",
        # Add more TB questions here
    ],
    "Agriculture": [
        "How can I improve soil fertility?", 
        # Add more Agriculture questions here
    ]
}
```

## Bedrock Evaluation

1. Upload generated `model_evaluation_dataset.jsonl` to S3
2. Create model evaluation job in AWS Bedrock console
3. Select dataset from S3 bucket
4. Choose evaluation metrics (Correctness, Helpfulness, Completeness)

## Dataset Format

```json
{
    "prompt": "What are the main symptoms of tuberculosis?",
    "referenceResponse": "Expert ground truth response...",
    "category": "TB", 
    "modelResponses": [{
        "response": "Actual API response...",
        "modelIdentifier": "iECHO-Strands-Chatbot"
    }]
}
```

## Performance Expectations

- **Response Time**: 3-7 seconds per request
- **Evaluation Metrics**: Correctness, Helpfulness, Completeness