# Model Evaluation Guide

This guide covers the evaluation framework for the iECHO RAG Chatbot, including dataset generation and AWS Bedrock model evaluation.

## Overview

The evaluation system tests the multi-agent orchestrator's performance across TB and Agriculture domains by generating evaluation datasets from live API responses and comparing them against expert ground truth.

## Directory Structure

```
evaluation/
├── collect_model_dataset.py      # Dataset generation script
├── model_evaluation_dataset.jsonl # Generated evaluation dataset
├── requirements.txt               # Python dependencies (requests, boto3)
├── README.md                     # Basic usage instructions
└── venv/                         # Python virtual environment
```

## Setup

### 1. Environment Setup

```bash
cd evaluation
python -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate
pip install -r requirements.txt
```

### 2. API Configuration

Update the API endpoint in `collect_model_dataset.py`:

```python
API_BASE_URL = "https://your-api-gateway-url.execute-api.region.amazonaws.com/prod"
```

## Dataset Generation

### Test Questions

The evaluation includes predefined questions for two domains:

**TB Questions (5 total):**
- What are the main symptoms of tuberculosis?
- How is TB diagnosed?
- What is the treatment for drug-resistant TB?
- How can TB transmission be prevented?
- What are the side effects of TB medications?

**Agriculture Questions (5 total):**
- How can I improve soil fertility in my farm?
- What are the best irrigation practices?
- How do I control pests organically?
- When is the best time to plant crops?
- How can I increase crop yield?

### Ground Truth Responses

Each test question has a corresponding expert-validated ground truth response stored in the `get_ground_truth()` function.

### Running Dataset Generation

```bash
python collect_model_dataset.py
```

**Process:**
1. Calls `/chat-stream` endpoint with each test question
2. Collects streaming responses from the multi-agent system
3. Pairs responses with ground truth answers
4. Generates JSONL format compatible with AWS Bedrock evaluation

### Dataset Format

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

## AWS Bedrock Evaluation

### 1. Upload Dataset

Upload the generated `model_evaluation_dataset.jsonl` to an S3 bucket.

### 2. Create Evaluation Job

1. Go to AWS Bedrock Console → Model evaluation
2. Create new evaluation job
3. Select dataset from S3 bucket
4. Choose evaluation metrics (Correctness, Helpfulness, Completeness)

### 3. Review Results

Bedrock provides detailed evaluation results comparing model responses against ground truth.

## API Integration

The evaluation script uses the same `/chat-stream` endpoint as the frontend:

**Request Format:**
```json
{
  "query": "test question",
  "userId": "eval-user",
  "sessionId": "eval-timestamp"
}
```

**Response Processing:**
- Handles streaming response format
- Collects content tokens and final response
- Includes error handling for API failures

## Adding Questions

To add new evaluation questions:

1. Update `TEST_PROMPTS` dictionary with new questions
2. Add corresponding ground truth in `get_ground_truth()` function
3. Run dataset generation script

```python
TEST_PROMPTS = {
    "TB": [
        "Existing questions...",
        "Your new TB question"
    ],
    "Agriculture": [
        "Existing questions...",
        "Your new agriculture question"
    ]
}
```
