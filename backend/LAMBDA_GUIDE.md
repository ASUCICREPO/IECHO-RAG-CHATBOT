# iECHO RAG Chatbot - Lambda Document Processor

## 🎯 Overview

The Lambda Document Processor automatically converts PowerPoint presentations (PPT/PPTX) to PDF format and processes various document types uploaded to your S3 bucket. This eliminates the need for manual document conversion and streamlines the document ingestion workflow.

## 🏗 Architecture

```
User uploads PPT → S3 uploads/ → Lambda Function → LibreOffice Conversion → PDF in processed/ → Knowledge Base Sync
```

### Components
- **Lambda Function**: `iecho-document-processor`
- **LibreOffice Layer**: For PPT to PDF conversion
- **S3 Trigger**: Automatically processes files uploaded to `uploads/` folder
- **Knowledge Base Integration**: Auto-syncs processed documents

## ✨ Features

### Supported Conversions
- **PPT/PPTX → PDF**: Automatic conversion using LibreOffice
- **PDF, TXT, MD, HTML, DOCX**: Direct processing (moved to processed folder)

### Automatic Processing
- **S3 Trigger**: Processes files immediately upon upload
- **Knowledge Base Sync**: Automatically triggers ingestion jobs
- **Error Handling**: Comprehensive logging and error recovery
- **File Validation**: Size and format validation

## 🚀 Deployment

### Prerequisites
- Existing iECHO RAG Chatbot deployment
- Knowledge Base ID and Data Source ID
- S3 bucket for documents

### Deploy Lambda Function
```bash
# Basic deployment (manual Knowledge Base sync)
./deploy-lambda.sh KNOWLEDGE_BASE_ID DOCUMENTS_BUCKET

# With auto-sync (recommended)
./deploy-lambda.sh KNOWLEDGE_BASE_ID DOCUMENTS_BUCKET DATA_SOURCE_ID

# Example
./deploy-lambda.sh VEBRQICW1Y iecho-documents-123456789-us-west-2 UAUJSEAURR
```

### What Gets Created
- **Lambda Function**: `iecho-document-processor`
- **IAM Role**: `iecho-document-processor-role`
- **IAM Policy**: `iecho-document-processor-policy`
- **S3 Trigger**: Processes files in `uploads/` folder
- **LibreOffice Layer**: For document conversion

## 📝 Usage

### Upload Documents for Processing

#### PowerPoint Files (Auto-converted)
```bash
# Upload PPT files - they will be converted to PDF automatically
aws s3 cp presentation.pptx s3://your-bucket/uploads/
aws s3 cp slides.ppt s3://your-bucket/uploads/
```

#### Other Supported Formats (Direct processing)
```bash
# These formats are moved directly to processed folder
aws s3 cp document.pdf s3://your-bucket/uploads/
aws s3 cp article.txt s3://your-bucket/uploads/
aws s3 cp readme.md s3://your-bucket/uploads/
aws s3 cp webpage.html s3://your-bucket/uploads/
aws s3 cp report.docx s3://your-bucket/uploads/
```

### Processing Workflow

1. **Upload**: User uploads file to `s3://bucket/uploads/`
2. **Trigger**: S3 event triggers Lambda function
3. **Processing**: 
   - PPT/PPTX files: Converted to PDF using LibreOffice
   - Other formats: Moved directly to processed folder
4. **Cleanup**: Original file deleted from uploads folder
5. **Sync**: Knowledge Base ingestion job triggered (if configured)
6. **Ready**: Document available for chat queries

## 🔍 Monitoring

### CloudWatch Logs
```bash
# View Lambda function logs
aws logs tail /aws/lambda/iecho-document-processor --follow --region us-west-2

# View recent logs
aws logs describe-log-streams \
  --log-group-name /aws/lambda/iecho-document-processor \
  --region us-west-2
```

### Function Status
```bash
# Check function configuration
aws lambda get-function --function-name iecho-document-processor --region us-west-2

# Check recent invocations
aws lambda get-function --function-name iecho-document-processor \
  --region us-west-2 --query 'Configuration.LastModified'
```

### S3 Bucket Contents
```bash
# Check uploads folder
aws s3 ls s3://your-bucket/uploads/

# Check processed folder
aws s3 ls s3://your-bucket/processed/

# Monitor processing
watch "aws s3 ls s3://your-bucket/uploads/ && echo '---' && aws s3 ls s3://your-bucket/processed/"
```

## 🚨 Troubleshooting

### Common Issues

#### 1. PPT Conversion Fails
**Symptoms**: PPT files uploaded but no PDF appears in processed folder

**Diagnosis**:
```bash
# Check Lambda logs
aws logs tail /aws/lambda/iecho-document-processor --region us-west-2
```

**Common Causes**:
- LibreOffice layer not attached
- File too large (>50MB)
- Corrupted PPT file
- Timeout (>5 minutes processing)

**Solutions**:
- Verify LibreOffice layer is attached to function
- Check file size and reduce if necessary
- Try with a simple PPT file first

#### 2. S3 Trigger Not Working
**Symptoms**: Files uploaded but Lambda not triggered

**Diagnosis**:
```bash
# Check S3 notification configuration
aws s3api get-bucket-notification-configuration --bucket your-bucket
```

**Solutions**:
- Verify S3 trigger is configured for `uploads/` prefix
- Check Lambda permissions for S3 invocation
- Ensure files are uploaded to correct folder

#### 3. Knowledge Base Sync Fails
**Symptoms**: Files processed but not available in chat

**Diagnosis**:
```bash
# Check ingestion jobs
aws bedrock-agent list-ingestion-jobs \
  --knowledge-base-id YOUR_KB_ID \
  --data-source-id YOUR_DS_ID \
  --region us-west-2
```

**Solutions**:
- Verify Data Source ID is correct
- Check Bedrock permissions in Lambda role
- Manually trigger sync if needed

### Debug Commands

```bash
# Test Lambda function manually
aws lambda invoke \
  --function-name iecho-document-processor \
  --payload '{"Records":[{"s3":{"bucket":{"name":"your-bucket"},"object":{"key":"uploads/test.txt"}}}]}' \
  --region us-west-2 \
  response.json

# Check function metrics
aws cloudwatch get-metric-statistics \
  --namespace AWS/Lambda \
  --metric-name Invocations \
  --dimensions Name=FunctionName,Value=iecho-document-processor \
  --start-time 2025-01-01T00:00:00Z \
  --end-time 2025-01-01T01:00:00Z \
  --period 3600 \
  --statistics Sum \
  --region us-west-2
```

## ⚙️ Configuration

### Environment Variables
- `KNOWLEDGE_BASE_ID`: Bedrock Knowledge Base ID
- `DATA_SOURCE_ID`: Bedrock Data Source ID (optional)

### Function Settings
- **Runtime**: Python 3.12
- **Memory**: 1024 MB
- **Timeout**: 300 seconds (5 minutes)
- **Layers**: LibreOffice layer for PPT conversion

### IAM Permissions
The Lambda function requires:
- S3 read/write access to documents bucket
- Bedrock agent permissions for ingestion jobs
- CloudWatch logs permissions

## 🔧 Advanced Configuration

### Custom File Size Limits
Edit the Lambda function to change file size limits:

```python
# In lambda_function.py
def is_file_size_acceptable(bucket: str, key: str, max_size_mb: int = 50) -> bool:
    # Change max_size_mb to your desired limit
```

### Additional File Formats
To support additional formats, update the file extension check:

```python
# In lambda_function.py
elif file_extension in ['pdf', 'txt', 'md', 'html', 'docx', 'rtf', 'odt']:
    # Add new formats to the list
```

### Custom Processing Logic
Add custom processing for specific file types:

```python
# In lambda_function.py
elif file_extension == 'xlsx':
    # Add custom Excel processing logic
    processed_key = process_excel_file(bucket, key, base_name)
```

## 💰 Cost Considerations

### Lambda Costs
- **Requests**: $0.20 per 1M requests
- **Duration**: $0.0000166667 per GB-second
- **Typical cost**: ~$0.01 per 100 document conversions

### LibreOffice Layer
- **Storage**: ~$0.01 per month for layer storage
- **No additional compute cost**

### S3 Costs
- **PUT requests**: $0.0005 per 1,000 requests
- **Storage**: Standard S3 pricing for processed files

## 🧹 Cleanup

### Remove Lambda Function
```bash
# Delete Lambda function
aws lambda delete-function --function-name iecho-document-processor --region us-west-2

# Delete IAM role and policy
aws iam detach-role-policy --role-name iecho-document-processor-role \
  --policy-arn arn:aws:iam::ACCOUNT:policy/iecho-document-processor-policy

aws iam delete-role --role-name iecho-document-processor-role
aws iam delete-policy --policy-arn arn:aws:iam::ACCOUNT:policy/iecho-document-processor-policy

# Remove S3 notification
aws s3api put-bucket-notification-configuration \
  --bucket your-bucket \
  --notification-configuration '{}'
```

### Included in Main Cleanup
The main `cleanup.sh` script will automatically remove Lambda resources when cleaning up the entire deployment.

## 📚 Additional Resources

- [AWS Lambda Documentation](https://docs.aws.amazon.com/lambda/)
- [LibreOffice Headless Mode](https://help.libreoffice.org/latest/en-US/text/shared/guide/start_parameters.html)
- [S3 Event Notifications](https://docs.aws.amazon.com/AmazonS3/latest/userguide/NotificationHowTo.html)
- [Bedrock Agent Runtime API](https://docs.aws.amazon.com/bedrock/latest/APIReference/API_agent-runtime_StartIngestionJob.html)

---

**The Lambda Document Processor makes your iECHO RAG Chatbot fully automated for document processing!** 🚀
