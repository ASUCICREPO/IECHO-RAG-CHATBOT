# iECHO RAG Chatbot - API Gateway Integration

## 🎯 Overview

This guide shows how to expose your iECHO RAG Chatbot through **Amazon API Gateway** for better API management, security, and scalability.

## 🏗 Architecture

```
Client → API Gateway → Application Load Balancer → EKS Fargate → Nova Lite
                                                        ↓
                                                 S3 Vector Store
                                                        ↓
                                                 Response + Citations
```

### Benefits of API Gateway Integration

- **🔒 Security**: API keys, throttling, and request validation
- **📊 Monitoring**: CloudWatch metrics and logging
- **🚀 Caching**: Response caching for better performance
- **🌐 CORS**: Built-in CORS support for web applications
- **📈 Scaling**: Rate limiting and quota management
- **🔧 Management**: Centralized API versioning and documentation

## 🚀 Quick Setup

### Option 1: Automated Setup (Recommended)

```bash
# Get your ALB URL
ALB_URL=$(kubectl get ingress iecho-rag-chatbot -o jsonpath='{.status.loadBalancer.ingress[0].hostname}')

# Set up API Gateway
./setup-api-gateway.sh $ALB_URL
```

### Option 2: Manual Setup

1. **Get ALB URL**:
   ```bash
   kubectl get ingress iecho-rag-chatbot -o jsonpath='{.status.loadBalancer.ingress[0].hostname}'
   ```

2. **Run completion script**:
   ```bash
   ./complete-api-gateway.sh
   ```

## 🔗 API Gateway Endpoints

### Base URL
```
https://nl40r7jl44.execute-api.us-west-2.amazonaws.com/prod/
```

### Available Endpoints

#### Health Check
```bash
GET /health

# Example
curl https://nl40r7jl44.execute-api.us-west-2.amazonaws.com/prod/health
```

**Response:**
```json
{
  "status": "healthy",
  "service": "iECHO RAG Chatbot API",
  "timestamp": "2025-08-04T03:14:03.150901"
}
```

#### System Status
```bash
GET /status

# Example
curl https://nl40r7jl44.execute-api.us-west-2.amazonaws.com/prod/status
```

**Response:**
```json
{
  "service": "iECHO RAG Chatbot API",
  "status": "running",
  "knowledgeBaseConfigured": true,
  "documentsConfigured": true,
  "feedbackConfigured": true,
  "region": "us-west-2"
}
```

#### Chat with Nova Lite
```bash
POST /chat
Content-Type: application/json

{
  "query": "What is machine learning?",
  "userId": "user-123",
  "sessionId": "optional-session-id"
}
```

**Example:**
```bash
curl -X POST https://nl40r7jl44.execute-api.us-west-2.amazonaws.com/prod/chat \
  -H 'Content-Type: application/json' \
  -d '{
    "query": "What is machine learning?",
    "userId": "api-user"
  }'
```

**Response:**
```json
{
  "response": "Machine learning is a subset of artificial intelligence that involves algorithms that learn from data...",
  "sessionId": "81c34a57-1b3c-4428-ba8f-3b6c8184bab7",
  "citations": [
    {
      "title": "Artificial Intelligence Overview...",
      "source": "s3://iecho-documents-138681986761-us-west-2/processed/ai-test.txt",
      "excerpt": "Artificial Intelligence Overview..."
    }
  ],
  "userId": "api-user"
}
```

#### Submit Feedback
```bash
POST /feedback
Content-Type: application/json

{
  "userId": "user-123",
  "responseId": "response-456",
  "rating": 5,
  "feedback": "Great response!"
}
```

**Example:**
```bash
curl -X POST https://nl40r7jl44.execute-api.us-west-2.amazonaws.com/prod/feedback \
  -H 'Content-Type: application/json' \
  -d '{
    "userId": "api-user",
    "responseId": "81c34a57-1b3c-4428-ba8f-3b6c8184bab7",
    "rating": 5,
    "feedback": "Excellent Nova Lite response!"
  }'
```

#### List Documents
```bash
GET /documents

# Example
curl https://nl40r7jl44.execute-api.us-west-2.amazonaws.com/prod/documents
```

**Response:**
```json
{
  "documents": [
    {
      "key": "processed/ai-test.txt",
      "name": "ai-test.txt",
      "size": 667,
      "lastModified": "2025-08-04T02:46:12+00:00"
    }
  ],
  "count": 1
}
```

## 🔑 API Key Usage (Optional)

If you set up API keys during deployment:

```bash
# Using API key
curl -H 'x-api-key: YOUR_API_KEY' \
  https://wj0q47605b.execute-api.us-west-2.amazonaws.com/prod/health
```

## 📊 Advanced Features

### Rate Limiting
- **Rate Limit**: 100 requests/second
- **Burst Limit**: 200 requests
- **Daily Quota**: 10,000 requests/day

### CORS Support
All endpoints support CORS for web applications:
- **Allowed Origins**: `*` (configurable)
- **Allowed Methods**: `GET, POST, OPTIONS`
- **Allowed Headers**: `Content-Type, Authorization, X-Api-Key`

### Monitoring
- **CloudWatch Metrics**: Request count, latency, errors
- **CloudWatch Logs**: Request/response logging
- **X-Ray Tracing**: Distributed tracing support

## 🔧 Configuration

### Environment Variables
The API Gateway passes all requests to your ALB, which forwards them to your EKS pods with these environment variables:

- `KNOWLEDGE_BASE_ID`: Your Bedrock Knowledge Base ID
- `DOCUMENTS_BUCKET`: S3 bucket for documents
- `FEEDBACK_TABLE_NAME`: DynamoDB table for feedback
- `AWS_REGION`: AWS region
- `AWS_ACCOUNT_ID`: Your AWS account ID

### Custom Domain (Optional)

To use a custom domain:

1. **Create ACM Certificate**:
   ```bash
   aws acm request-certificate \
     --domain-name api.yourdomain.com \
     --validation-method DNS \
     --region us-west-2
   ```

2. **Create Custom Domain**:
   ```bash
   aws apigateway create-domain-name \
     --domain-name api.yourdomain.com \
     --certificate-arn arn:aws:acm:us-west-2:account:certificate/cert-id \
     --region us-west-2
   ```

3. **Create Base Path Mapping**:
   ```bash
   aws apigateway create-base-path-mapping \
     --domain-name api.yourdomain.com \
     --rest-api-id wj0q47605b \
     --stage prod \
     --region us-west-2
   ```

## 🚨 Troubleshooting

### Common Issues

#### 1. 502 Bad Gateway
**Cause**: ALB not accessible from API Gateway
**Solution**: Check ALB health and security groups

#### 2. CORS Errors
**Cause**: Missing CORS configuration
**Solution**: Ensure OPTIONS methods are configured

#### 3. Rate Limiting
**Cause**: Exceeded API Gateway limits
**Solution**: Check usage plan settings

### Debug Commands

```bash
# Check API Gateway configuration
aws apigateway get-rest-api --rest-api-id wj0q47605b --region us-west-2

# Check resources
aws apigateway get-resources --rest-api-id wj0q47605b --region us-west-2

# Check stage configuration
aws apigateway get-stage --rest-api-id wj0q47605b --stage-name prod --region us-west-2

# View CloudWatch logs
aws logs describe-log-groups --log-group-name-prefix "/aws/apigateway" --region us-west-2
```

## 💰 Cost Considerations

### API Gateway Pricing (us-west-2)
- **REST API Requests**: $3.50 per million requests
- **Data Transfer**: $0.09 per GB
- **Caching**: $0.02 per hour per GB (optional)

### Monthly Cost Estimates
- **10K requests/day**: ~$1.05/month
- **100K requests/day**: ~$10.50/month
- **1M requests/day**: ~$105/month

### Cost Optimization
- **Enable Caching**: Reduce backend calls
- **Use Edge Locations**: Lower latency and costs
- **Monitor Usage**: Set up billing alerts

## 🔒 Security Best Practices

### API Key Management
```bash
# Rotate API keys regularly
aws apigateway create-api-key --name new-key --enabled --region us-west-2

# Disable old keys
aws apigateway update-api-key --api-key old-key-id --patch-ops op=replace,path=/enabled,value=false --region us-west-2
```

### Request Validation
Add request validation to prevent malformed requests:

```bash
# Create request validator
aws apigateway create-request-validator \
  --rest-api-id wj0q47605b \
  --name chat-validator \
  --validate-request-body true \
  --validate-request-parameters true \
  --region us-west-2
```

### WAF Integration
For additional security, integrate with AWS WAF:

```bash
# Create WAF web ACL
aws wafv2 create-web-acl \
  --name iecho-api-protection \
  --scope REGIONAL \
  --default-action Allow={} \
  --region us-west-2
```

## 📈 Monitoring and Alerting

### CloudWatch Metrics
- `4XXError`: Client errors
- `5XXError`: Server errors
- `Count`: Request count
- `Latency`: Response time

### Sample Alarms
```bash
# High error rate alarm
aws cloudwatch put-metric-alarm \
  --alarm-name "iECHO-API-High-Error-Rate" \
  --alarm-description "High error rate on API Gateway" \
  --metric-name 4XXError \
  --namespace AWS/ApiGateway \
  --statistic Sum \
  --period 300 \
  --threshold 10 \
  --comparison-operator GreaterThanThreshold \
  --region us-west-2
```

## 🧹 Cleanup

To remove API Gateway resources:

```bash
# Delete API Gateway
aws apigateway delete-rest-api --rest-api-id wj0q47605b --region us-west-2

# Delete usage plans and API keys (if created)
aws apigateway delete-usage-plan --usage-plan-id PLAN_ID --region us-west-2
aws apigateway delete-api-key --api-key API_KEY_ID --region us-west-2
```

## 📚 Additional Resources

- [API Gateway Developer Guide](https://docs.aws.amazon.com/apigateway/)
- [API Gateway Pricing](https://aws.amazon.com/api-gateway/pricing/)
- [CloudWatch API Gateway Metrics](https://docs.aws.amazon.com/apigateway/latest/developerguide/api-gateway-metrics-and-dimensions.html)
- [API Gateway Security](https://docs.aws.amazon.com/apigateway/latest/developerguide/security.html)

---

**Your iECHO RAG Chatbot is now accessible via API Gateway with enterprise-grade features!** 🚀
