# Manual Knowledge Base Setup Guide

Since S3 Vectors is not yet supported in the AWS CLI, we need to create the Knowledge Base manually through the AWS Console. This guide will walk you through the process step by step.

## Important Notes

### 📦 **About Vector Storage**

When you create a Knowledge Base with S3 Vectors through the AWS Console, **Bedrock automatically creates and manages its own dedicated S3 bucket** for vector storage. You don't need to create or manage any vector storage buckets yourself.

**What this means:**
- ✅ **Document Bucket**: `iecho-documents-138681986761-us-west-2` - **USED** (for source documents)
- ✅ **Vector Storage**: **Automatically managed by Bedrock** (no manual setup required)

### 🔄 **Resource Usage Summary**

| Resource | Created By | Status | Purpose |
|----------|------------|--------|---------|
| Document Bucket | CDK | ✅ Used | Source documents storage |
| Vector Storage | Bedrock | ✅ Used | Managed automatically by Bedrock |

## Prerequisites

✅ **Infrastructure Deployed**: The CDK stack should be successfully deployed
✅ **Bedrock Models Enabled**: Ensure you have access to required Bedrock models
✅ **AWS Console Access**: You need access to the AWS Console

## Step 1: Enable Bedrock Models

1. Go to **AWS Console** → **Amazon Bedrock** → **Model access**
2. Click **"Enable specific models"**
3. Enable the following models:
   - ✅ **Amazon Titan Embed Text v2** (for embeddings)
   - ✅ **Amazon Nova Lite** (for response generation)
4. Wait for models to be enabled (may take a few minutes)

## Step 2: Create Knowledge Base

### 2.1 Navigate to Knowledge Bases

1. Go to **AWS Console** → **Amazon Bedrock** → **Knowledge bases**
2. Click **"Create knowledge base"**

### 2.2 Knowledge Base Configuration

**Knowledge base details:**
- **Name**: `iecho-multimodal-kb`
- **Description**: `Knowledge base for iECHO multi-modal document processing with S3 vector store`

**IAM service role:**
- Select **"Use an existing service role"**
- **Service role**: `IEchoRagChatbotStack-KnowledgeBaseRoleA2B317B9-XXXXXXXXX`
  - ℹ️ *This role was created by the CDK deployment*

Click **"Next"**

### 2.3 Vector Database Configuration

**Select vector database:**
- Choose **"Amazon S3"** (S3 Vectors option)

**S3 configuration:**
- ⚠️ **Important**: When you select S3 Vectors, Bedrock will automatically create and manage its own dedicated S3 bucket for vector storage
- You don't need to specify any vector bucket - Bedrock handles all vector storage internally
- The CDK deployment only created the document bucket, which is used for source documents

**Embeddings model:**
- **Embeddings model**: `Amazon Titan Embed Text v2`
- **Dimensions**: `1024`
- **Normalize embeddings**: ✅ **Enabled**

Click **"Next"**

### 2.4 Review and Create

1. Review all settings
2. Click **"Create knowledge base"**
3. **📝 IMPORTANT**: Copy the **Knowledge Base ID** (you'll need this later)
   - Example: `ABCD1234EF`

## Step 3: Create Data Source

### 3.1 Add Data Source

1. After the Knowledge Base is created, click **"Add data source"**
2. Or go to your Knowledge Base → **"Data sources"** tab → **"Add data source"**

### 3.2 Data Source Configuration

**Data source details:**
- **Name**: `iecho-document-source`
- **Description**: `S3 data source with Bedrock Data Automation parsing for multi-modal documents`

**Source:**
- **Data source type**: **Amazon S3**
- **S3 URI**: `s3://iecho-documents-138681986761-us-west-2/processed/`
  - ℹ️ *This is the processed documents folder from CDK deployment*

Click **"Next"**

### 3.3 Chunking and Parsing Configuration

**Chunking strategy:**
- Select **"Hierarchical chunking"**
- **Parent chunk - Max tokens**: `1500`
- **Child chunk - Max tokens**: `300`
- **Overlap percentage**: `20`

**Parsing strategy:**
- Select **"Bedrock Data Automation"**
- **Parsing prompt**: Copy and paste the following:

```
Extract and structure all content including text, tables, images, and metadata. Preserve document hierarchy and relationships between sections. For multi-modal content: convert tables to structured text, describe visual content, extract text from images, and maintain presentation slide structure.
```

Click **"Next"**

### 3.4 Review and Create Data Source

1. Review all settings
2. Click **"Create data source"**
3. **📝 IMPORTANT**: Copy the **Data Source ID** (you'll need this later)
   - Example: `WXYZ5678GH`

## Step 4: Update Application Configuration

Now that you have both IDs, run the configuration update script:

```bash
cd backend
./update-configs.sh
```

When prompted, enter:
- **Knowledge Base ID**: The ID you copied in Step 2.4
- **Data Source ID**: The ID you copied in Step 3.4

## Step 5: Verify Setup

### 5.1 Check Knowledge Base Status

1. Go to **Bedrock Console** → **Knowledge bases** → **Your KB**
2. Status should be **"Active"**
3. Data source status should be **"Available"**

### 5.2 Check EKS Pods

```bash
# Update kubeconfig
aws eks update-kubeconfig --region us-west-2 --name iecho-agent-cluster

# Check pods
kubectl get pods -n iecho-agents

# Check pod logs
kubectl logs -f deployment/iecho-rag-agent -n iecho-agents
```

### 5.3 Test API Health

```bash
# Replace with your actual API Gateway URL
curl -X GET https://kvgfgjigk7.execute-api.us-west-2.amazonaws.com/health
```

Expected response:
```json
{
  "status": "healthy",
  "service": "iECHO RAG Agent (Strands SDK - Always Running)",
  "knowledge_base_id": "YOUR_ACTUAL_KB_ID",
  "uptime": "Always running - no cold starts"
}
```

## Step 6: Test Document Processing

### 6.1 Upload Test Document

1. Go to **S3 Console** → **iecho-documents-138681986761-us-west-2**
2. Upload a PDF or PowerPoint file to the **`uploads/`** folder
3. The Lambda function will automatically process it and move it to **`processed/`**

### 6.2 Sync Data Source

1. Go to **Bedrock Console** → **Knowledge bases** → **Your KB** → **Data sources**
2. Select your data source
3. Click **"Sync"** to ingest the new documents
4. Wait for sync to complete (status: "Complete")

### 6.3 Test Chat API

```bash
curl -X POST https://kvgfgjigk7.execute-api.us-west-2.amazonaws.com/chat \
  -H "Content-Type: application/json" \
  -d '{"query": "What documents do you have access to?", "userId": "test-user"}'
```

## Troubleshooting

### Common Issues

1. **Knowledge Base creation fails**:
   - Check that the IAM role exists and has proper permissions
   - Verify the S3 bucket exists and is accessible

2. **Data Source creation fails**:
   - Ensure the S3 URI is correct: `s3://iecho-documents-138681986761-us-west-2/processed/`
   - Check that the bucket has the correct permissions

3. **Pods not starting**:
   - Check if ConfigMap was updated: `kubectl get configmap iecho-config -n iecho-agents -o yaml`
   - Restart deployment: `kubectl rollout restart deployment/iecho-rag-agent -n iecho-agents`

4. **API returns errors**:
   - Check pod logs: `kubectl logs -f deployment/iecho-rag-agent -n iecho-agents`
   - Verify Knowledge Base ID in ConfigMap matches the actual ID

### Getting Help

- Check CloudWatch logs for Lambda function errors
- Monitor EKS pod logs for application errors
- Verify all AWS resources are in the same region (us-west-2)

## Summary

After completing this setup:

✅ **Knowledge Base**: Created with S3 Vectors storage (Bedrock-managed)
✅ **Data Source**: Configured with Bedrock Data Automation
✅ **Application**: Updated with real Knowledge Base and Data Source IDs
✅ **EKS Pods**: Restarted with new configuration
✅ **API**: Ready to process chat requests

Your iECHO RAG Chatbot is now fully operational with S3 Vectors storage!
