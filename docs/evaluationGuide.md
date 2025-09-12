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

### Prerequisites

1. **AWS Bedrock Access**: Ensure you have access to Amazon Bedrock models in your AWS region
2. **IAM Permissions**: Configure service role with Bedrock and S3 permissions
3. **S3 Buckets**: Prepare buckets for dataset storage and results

### Step 1: Upload Dataset to S3

1. **Open AWS S3 Console**
   - Navigate to [S3 Console](https://console.aws.amazon.com/s3/)
   - Click **"Create bucket"** or select existing bucket
   - Name: `iecho-evaluation-data` (or your preferred name)

2. **Upload Evaluation Dataset**
   - Click on your bucket name
   - Click **"Upload"** → **"Add files"**
   - Select `model_evaluation_dataset.jsonl` from your local machine
   - Click **"Upload"**

3. **Note the S3 URI**
   - Copy the S3 URI: `s3://your-bucket-name/model_evaluation_dataset.jsonl`

### Step 2: Create IAM Service Role

1. **Open IAM Console**
   - Navigate to [IAM Console](https://console.aws.amazon.com/iam/)
   - Click **"Roles"** in the left sidebar
   - Click **"Create role"**

2. **Configure Role**
   - **Trusted entity type**: AWS service
   - **Service**: Bedrock
   - Click **"Next"**

3. **Attach Policies**
   - Search and select: `AmazonBedrockFullAccess`
   - Search and select: `AmazonS3FullAccess` (or create custom S3 policy)
   - Click **"Next"**

4. **Name and Create**
   - **Role name**: `BedrockEvaluationRole`
   - **Description**: `Service role for Bedrock evaluation jobs`
   - Click **"Create role"**
   - **Note the Role ARN** for later use

### Step 3: Create Model as Judge Evaluation Job

1. **Open AWS Bedrock Console**
   - Navigate to [Bedrock Console](https://console.aws.amazon.com/bedrock/)
   - Click **"Model evaluations"** in the left sidebar
   - Click **"Create"**

2. **Select Evaluation Type**
   - Select **"Automatic: Model as judge"**
   - Click **"Next"**

3. **Configure Job Details**
   - **Evaluation name**: `iECHO-Model-Judge-Evaluation`
   - **Description**: `Evaluation of iECHO chatbot using model as judge`
   - Click **"Next"**

4. **Select Models**
   - **Evaluator model**: Choose `Claude 3.5 Sonnet` (or your preferred judge model)
   - **Generator model**: Select your target model
   - Click **"Next"**

5. **Configure Dataset**
   - **Dataset source**: S3
   - **S3 URI**: `s3://your-bucket-name/model_evaluation_dataset.jsonl`
   - **Dataset format**: JSONL
   - Click **"Next"**

6. **Choose Evaluation Metrics**
   - Select from available metrics:
     - ✅ **Correctness** - How accurate is the response?
     - ✅ **Completeness** - How complete is the response?
     - ✅ **Helpfulness** - How helpful is the response?
     - ✅ **Harmfulness** - How harmful or inappropriate is the content?
     - ✅ **Professional Style** - How professional is the tone?
   - Click **"Next"**

7. **Configure Output and Permissions**
   - **Output S3 bucket**: Select your evaluation bucket
   - **Output prefix**: `evaluation-results/model-judge/`
   - **Service role**: Select `BedrockEvaluationRole` from dropdown
   - Click **"Next"**

8. **Review and Create**
   - Review all configuration settings
   - Click **"Create"**

### Step 4: Monitor and Review Results

1. **View Evaluation Status**
   - In Bedrock Console → **"Model evaluations"**
   - Find your evaluation job in the list
   - Status will show: **"In progress"**, **"Completed"**, or **"Failed"**

2. **Monitor Progress**
   - Click on your evaluation name to see details
   - View progress percentage and estimated completion time
   - Check **"Logs"** tab for any issues

3. **Access Results**
   - Once status shows **"Completed"**, click on your evaluation
   - Go to **"Results"** tab
   - Click **"Download results"** or **"View in S3"**

4. **Navigate to S3 Results**
   - Open [S3 Console](https://console.aws.amazon.com/s3/)
   - Navigate to your evaluation bucket
   - Go to `evaluation-results/model-judge/` folder
   - Download the results files

### Step 5: Interpret Results

#### Understanding the Scores
- **Score Range**: 1-5 scale (1 = Poor, 5 = Excellent)
- **Overall Performance**: Average score across all metrics
- **Domain Analysis**: Compare TB vs Agriculture question performance
- **Consistency**: Look for score variance across similar questions

#### Key Metrics to Focus On
- **Correctness**: Medical accuracy for TB questions, practical accuracy for Agriculture
- **Completeness**: Coverage of all important aspects of the question
- **Helpfulness**: Actionable and practical advice for users
- **Harmfulness**: Ensure responses are safe and appropriate
- **Professional Style**: Appropriate tone for healthcare/agriculture contexts

#### Action Items Based on Results
- **Low Correctness Scores**: Review knowledge base content and agent prompts
- **Low Completeness Scores**: Enhance response generation to cover more aspects
- **Low Helpfulness Scores**: Improve response formatting and practical guidance
- **High Harmfulness Scores**: Review content filtering and safety measures
- **Low Professional Style**: Refine agent personality and tone settings

### Troubleshooting Common Issues

#### Permission Errors
- **Issue**: "Access denied" when creating evaluation
- **Solution**: Ensure IAM role has `AmazonBedrockFullAccess` and appropriate S3 permissions

#### Dataset Format Errors
- **Issue**: "Invalid dataset format" error
- **Solution**: Verify JSONL format and ensure each line is valid JSON

#### Model Access Issues
- **Issue**: "Model not available" error
- **Solution**: Check model availability in your AWS region and request access if needed

#### Evaluation Timeout
- **Issue**: Evaluation job stuck in "In progress" status
- **Solution**: Check CloudWatch logs for errors, consider reducing dataset size for testing

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
