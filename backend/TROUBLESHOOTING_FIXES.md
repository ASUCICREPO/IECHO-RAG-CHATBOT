# iECHO RAG Chatbot - Troubleshooting & Fixes

## 🔧 Complete Fix History

This document contains all the issues we encountered and their solutions during development.

## 🚨 Major Issues & Solutions

### 1. S3 Vector Store Knowledge Base Creation Failures

#### **Issue**: CLI Knowledge Base Creation Syntax Errors
```bash
Error: "You cannot provide a different storage configuration than s3VectorsConfiguration when storage type is S3_VECTORS"
```

#### **Root Cause**: 
- AWS CLI syntax for S3 Vector Store is complex and inconsistent
- Parameter validation issues with `s3VectorsConfiguration`
- Version mismatches between CLI and service

#### **Solution**: Manual Knowledge Base Creation
- **Approach**: Create Knowledge Base via AWS Console
- **Reliability**: 100% success rate vs ~30% with CLI
- **Benefits**: Visual validation, clear error messages

#### **Implementation**:
```bash
# Instead of CLI creation, use manual process:
# 1. AWS Console → Bedrock → Knowledge bases
# 2. Create with S3 Vector Store type
# 3. Use deployment script with KB ID
./deploy.sh YOUR_KNOWLEDGE_BASE_ID
```

---

### 2. Nova Lite Model Access Issues

#### **Issue**: Nova Lite On-Demand Throughput Error
```bash
Error: "Invocation of model ID amazon.nova-lite-v1:0 with on-demand throughput isn't supported. Retry your request with the ID or ARN of an inference profile"
```

#### **Root Cause**: 
- Nova Lite requires inference profile for on-demand usage
- Direct model ARN doesn't work with on-demand throughput

#### **Solution**: Use Nova Lite Inference Profile
```python
# OLD (Broken):
'modelArn': 'arn:aws:bedrock:us-west-2::foundation-model/amazon.nova-lite-v1:0'

# NEW (Working):
'modelArn': 'arn:aws:bedrock:us-west-2:{account-id}:inference-profile/us.amazon.nova-lite-v1:0'
```

#### **Implementation**:
```python
# In app.py
response = bedrock_agent_runtime.retrieve_and_generate(
    input={'text': request.query},
    retrieveAndGenerateConfiguration={
        'type': 'KNOWLEDGE_BASE',
        'knowledgeBaseConfiguration': {
            'knowledgeBaseId': KNOWLEDGE_BASE_ID,
            'modelArn': f'arn:aws:bedrock:{AWS_REGION}:{AWS_ACCOUNT_ID}:inference-profile/us.amazon.nova-lite-v1:0'
        }
    }
)
```

---

### 3. S3 Vector Store Metadata Size Limit

#### **Issue**: Document Ingestion Failures
```bash
Error: "Invalid record for key 'xxx': Filterable metadata must have at most 2048 bytes"
```

#### **Root Cause**: 
- S3 Vector Store has 2KB limit on filterable metadata
- Complex PDFs generate large metadata
- Bedrock automatically extracts metadata from documents

#### **Solution**: Document Preprocessing Strategy
1. **Use Simple Documents**: Text files work best
2. **Minimize Metadata**: Strip unnecessary document properties
3. **Monitor Ingestion**: Check job status for failures

#### **Implementation**:
```bash
# Good: Simple text documents
echo "Content here" > simple-doc.txt
aws s3 cp simple-doc.txt s3://bucket/processed/

# Avoid: Complex PDFs with large metadata
# These may exceed 2KB filterable metadata limit
```

#### **S3 Vector Store Limits**:
- **Filterable metadata**: 2KB per vector
- **Total metadata**: 40KB per vector
- **Write throughput**: 5 requests/second
- **Vectors per index**: 50 million

---

### 4. EKS Pod Identity Permission Issues

#### **Issue**: Bedrock Access Denied
```bash
Error: "User: arn:aws:sts::xxx:assumed-role/eks-role is not authorized to perform: bedrock:RetrieveAndGenerate"
```

#### **Root Cause**: 
- Pod Identity role missing Bedrock permissions
- Policy not attached to correct IAM role
- Permission propagation delays

#### **Solution**: Comprehensive IAM Policy
```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "bedrock:*",
        "bedrock-agent:*",
        "bedrock-agent-runtime:*"
      ],
      "Resource": "*"
    },
    {
      "Effect": "Allow",
      "Action": [
        "s3:GetObject",
        "s3:PutObject",
        "s3:DeleteObject",
        "s3:ListBucket"
      ],
      "Resource": [
        "arn:aws:s3:::iecho-documents-*",
        "arn:aws:s3:::iecho-documents-*/*"
      ]
    },
    {
      "Effect": "Allow",
      "Action": [
        "dynamodb:PutItem",
        "dynamodb:GetItem",
        "dynamodb:Query",
        "dynamodb:Scan"
      ],
      "Resource": "arn:aws:dynamodb:*:*:table/iecho-feedback-table"
    }
  ]
}
```

#### **Implementation**:
```bash
# Attach AWS managed policy for comprehensive access
aws iam attach-role-policy \
  --role-name eks-iecho-rag-chatbot-manual \
  --policy-arn arn:aws:iam::aws:policy/AmazonBedrockFullAccess

# Restart pods to pick up new permissions
kubectl rollout restart deployment iecho-rag-chatbot
```

---

### 5. Helm Environment Variable Type Issues

#### **Issue**: Deployment Failures with Environment Variables
```bash
Error: "json: cannot unmarshal number into Go struct field EnvVar.spec.template.spec.containers.env.value of type string"
```

#### **Root Cause**: 
- Helm treating numeric values as numbers instead of strings
- Kubernetes requires all env var values to be strings
- AWS_ACCOUNT_ID being passed as integer

#### **Solution**: Force String Type in Helm
```bash
# OLD (Broken):
--set env[4].value=138681986761

# NEW (Working):
--set-string env[4].value="138681986761"
```

#### **Implementation**:
```bash
helm install iecho-rag-chatbot ./chart \
  --set env[0].name="KNOWLEDGE_BASE_ID" \
  --set env[0].value="VEBRQICW1Y" \
  --set env[4].name="AWS_ACCOUNT_ID" \
  --set-string env[4].value="138681986761"
```

---

### 6. Helm Release Cleanup Issues

#### **Issue**: Cannot Reinstall After Failed Deployment
```bash
Error: "cannot re-use a name that is still in use"
```

#### **Root Cause**: 
- Failed Helm releases leave resources behind
- Kubernetes resources not properly cleaned up
- Release metadata persists

#### **Solution**: Complete Cleanup Process
```bash
# 1. Uninstall Helm release
helm uninstall iecho-rag-chatbot --no-hooks

# 2. Clean up remaining resources
kubectl delete all,ingress,configmap,secret,serviceaccount,pdb \
  -l app.kubernetes.io/name=iecho-rag-chatbot

# 3. Verify cleanup
helm list -a
kubectl get all

# 4. Wait before redeployment
sleep 10
```

---

### 7. Application Load Balancer DNS Resolution

#### **Issue**: ALB URL Not Resolving
```bash
Error: "Could not resolve host: k8s-default-iechorag-xxx.elb.amazonaws.com"
```

#### **Root Cause**: 
- ALB provisioning takes 2-3 minutes
- DNS propagation delays
- Regional DNS caching

#### **Solution**: Wait and Verify Strategy
```bash
# 1. Check ALB exists in AWS
aws elbv2 describe-load-balancers --region us-west-2 \
  --query 'LoadBalancers[?contains(DNSName, `k8s-default-iechorag`)].State'

# 2. Test via port-forward first
kubectl port-forward deployment/iecho-rag-chatbot 8080:8000 &
curl http://localhost:8080/health

# 3. Wait for DNS propagation
sleep 120
curl http://ALB_URL/health
```

---

## 🔍 Diagnostic Commands

### Knowledge Base Issues
```bash
# Check Knowledge Base status
aws bedrock-agent get-knowledge-base --knowledge-base-id YOUR_KB_ID --region us-west-2

# Check data sources
aws bedrock-agent list-data-sources --knowledge-base-id YOUR_KB_ID --region us-west-2

# Check ingestion jobs
aws bedrock-agent list-ingestion-jobs \
  --knowledge-base-id YOUR_KB_ID \
  --data-source-id YOUR_DS_ID \
  --region us-west-2

# Get ingestion job details
aws bedrock-agent get-ingestion-job \
  --knowledge-base-id YOUR_KB_ID \
  --data-source-id YOUR_DS_ID \
  --ingestion-job-id YOUR_JOB_ID \
  --region us-west-2
```

### EKS and Pod Issues
```bash
# Check pod status and logs
kubectl get pods -l app.kubernetes.io/name=iecho-rag-chatbot
kubectl logs -l app.kubernetes.io/name=iecho-rag-chatbot --tail=50

# Check deployment status
kubectl describe deployment iecho-rag-chatbot

# Check service and ingress
kubectl get svc,ingress
kubectl describe ingress iecho-rag-chatbot

# Check Pod Identity
aws eks describe-pod-identity-association \
  --cluster-name iecho-rag-cluster \
  --association-id YOUR_ASSOCIATION_ID \
  --region us-west-2
```

### IAM and Permissions
```bash
# Check attached policies
aws iam list-attached-role-policies --role-name eks-iecho-rag-chatbot-manual

# Check policy content
aws iam get-policy-version \
  --policy-arn arn:aws:iam::ACCOUNT:policy/POLICY_NAME \
  --version-id v1

# Test permissions
aws bedrock list-foundation-models --region us-west-2
aws bedrock-agent list-knowledge-bases --region us-west-2
```

## 🎯 Best Practices Learned

### 1. Knowledge Base Creation
- ✅ **Use AWS Console** for S3 Vector Store creation
- ✅ **Test with simple documents** first
- ✅ **Monitor ingestion jobs** for failures
- ❌ Avoid CLI creation for S3 Vector Store

### 2. Model Configuration
- ✅ **Use inference profiles** for Nova models
- ✅ **Include account ID** in ARN
- ✅ **Test model access** before deployment
- ❌ Don't use direct model ARNs for on-demand

### 3. Document Management
- ✅ **Keep metadata minimal** (< 2KB filterable)
- ✅ **Use simple text formats** when possible
- ✅ **Monitor ingestion throughput** (5 writes/sec limit)
- ❌ Avoid complex PDFs with large metadata

### 4. Deployment Strategy
- ✅ **Clean up completely** before redeployment
- ✅ **Use string types** for all env vars
- ✅ **Wait for ALB provisioning** (2-3 minutes)
- ✅ **Test via port-forward** first

### 5. Permissions Management
- ✅ **Use comprehensive policies** initially
- ✅ **Restart pods** after permission changes
- ✅ **Test permissions** before deployment
- ✅ **Monitor CloudWatch logs** for access issues

## 🚀 Performance Optimizations

### 1. S3 Vector Store Optimization
```bash
# Batch document uploads
aws s3 sync ./documents/ s3://bucket/processed/ --exclude "*.tmp"

# Monitor write throughput
aws cloudwatch get-metric-statistics \
  --namespace AWS/S3Vectors \
  --metric-name WriteThrottles
```

### 2. EKS Resource Optimization
```yaml
# Optimal resource settings
resources:
  requests:
    cpu: 250m
    memory: 512Mi
  limits:
    cpu: 500m
    memory: 1Gi
```

### 3. Caching Strategy
```python
# Implement response caching for repeated queries
@lru_cache(maxsize=100)
def cached_bedrock_query(query_hash):
    # Cache responses for identical queries
    pass
```

## 📊 Monitoring and Alerting

### CloudWatch Metrics to Monitor
- **EKS Pod CPU/Memory**: Resource utilization
- **ALB Request Count**: Traffic patterns
- **Bedrock Invocations**: Model usage
- **S3 Vector Store Writes**: Ingestion rate
- **DynamoDB Throttles**: Feedback system health

### Recommended Alerts
```bash
# High error rate
aws cloudwatch put-metric-alarm \
  --alarm-name "iECHO-High-Error-Rate" \
  --metric-name "HTTPCode_Target_5XX_Count"

# Pod restart frequency
kubectl create -f pod-restart-alert.yaml
```

---

**This document captures all major issues and solutions encountered during development. Keep it updated as new issues are discovered and resolved.**
