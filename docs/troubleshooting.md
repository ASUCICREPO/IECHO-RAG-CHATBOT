# Troubleshooting Guide

## Common Issues and Solutions

### Deployment Issues

#### 1. AWS CLI Configuration Problems

**Problem**: `aws configure` fails or credentials not working
```bash
Error: Unable to locate credentials
```

**Solutions**:
- Verify AWS CLI installation: `aws --version`
- Run `aws configure` with valid access keys
- Check IAM user permissions (see [Deployment Guide](./deploymentGuide.md))
- Test with: `aws sts get-caller-identity`

#### 2. Knowledge Base Not Found

**Problem**: Deployment fails with Knowledge Base ID error
```bash
Error: Knowledge Base KB123456789 not found
```

**Solutions**:
- Verify Knowledge Base exists in AWS Bedrock Console
- Check Knowledge Base ID format (10 uppercase alphanumeric characters)
- Ensure Knowledge Base is in the same region as deployment
- Confirm data source is synced and active

#### 3. CodeBuild Permission Errors

**Problem**: Deploy script fails to create CodeBuild project
```bash
Error: User is not authorized to perform: codebuild:CreateProject
```

**Solutions**:
- Attach `PowerUserAccess` policy to your IAM user
- Or add specific permissions from [Deployment Guide](./deploymentGuide.md)
- Verify IAM user has `iam:CreateRole` permission
- Check AWS region matches your configuration

#### 4. EKS Cluster Creation Timeout

**Problem**: Deployment hangs during EKS cluster creation
```bash
EKS cluster creation taking longer than expected...
```

**Solutions**:
- **Normal behavior**: EKS clusters take 30-45 minutes to create
- Monitor CloudWatch logs: `/aws/codebuild/your-project-name`
- Check AWS Service Health Dashboard for EKS issues
- Verify VPC limits haven't been exceeded

#### 5. Docker Build Failures

**Problem**: Container image build fails in CodeBuild
```bash
Error: docker build failed
```

**Solutions**:
- Check buildspec.yml syntax
- Verify Dockerfile exists in `backend/docker/`
- Monitor CodeBuild logs for specific error details
- Ensure sufficient CodeBuild compute resources

### Runtime Issues

#### 1. API Gateway 502/503 Errors

**Problem**: API returns server errors
```bash
{"message": "Internal server error"}
```

**Solutions**:
- Check EKS pod status: `kubectl get pods`
- Verify ALB health checks are passing
- Check application logs in CloudWatch
- Ensure Knowledge Base is accessible
- Verify IAM roles have correct permissions

#### 2. Slow Response Times

**Problem**: Responses take longer than 25 seconds
```bash
Request timeout after 25 seconds
```

**Solutions**:
- **Normal range**: 3-7 seconds for most queries
- Complex queries may take longer
- Check Knowledge Base performance
- Monitor EKS pod resource usage
- Verify network connectivity to Bedrock

#### 3. Knowledge Base Access Errors

**Problem**: "Knowledge base access denied" errors
```bash
Error: Unable to access knowledge base
```

**Solutions**:
- Verify EKS service account IAM role permissions
- Check Bedrock service availability
- Ensure Knowledge Base data source is synced
- Verify S3 bucket permissions for vector store

#### 4. Image Upload Failures

**Problem**: Image uploads fail or timeout
```bash
Error: Image processing failed
```

**Solutions**:
- Check image size (max 10MB)
- Verify supported formats: JPG, PNG, GIF, WebP
- Ensure strands_tools.image_reader is available
- Check temporary file system permissions

#### 5. Session Management Issues

**Problem**: Conversation context lost unexpectedly
```bash
Session expired or not found
```

**Solutions**:
- **Normal behavior**: Sessions expire after 1 hour
- Check session ID consistency in requests
- Verify in-memory session store is functioning
- Monitor application memory usage

### Frontend Issues

#### 1. Amplify Build Failures

**Problem**: Frontend deployment fails
```bash
Amplify build failed with exit code 1
```

**Solutions**:
- Check GitHub repository access
- Verify branch name is `full-cdk`
- Review Amplify build logs in AWS Console
- Ensure package.json dependencies are correct

#### 2. CORS Errors

**Problem**: Browser blocks API requests
```bash
CORS policy: No 'Access-Control-Allow-Origin' header
```

**Solutions**:
- Verify API Gateway CORS configuration
- Check ALB and EKS service CORS settings
- Ensure frontend uses correct API Gateway URL
- Clear browser cache and cookies

#### 3. Real-time Streaming Issues

**Problem**: Streaming responses don't work
```bash
EventSource connection failed
```

**Solutions**:
- Verify `/chat-stream` endpoint accessibility
- Check browser EventSource support
- Monitor network connectivity
- Ensure API Gateway timeout settings

### Performance Issues

#### 1. High Memory Usage

**Problem**: EKS pods consuming excessive memory
```bash
Pod memory usage above 1Gi limit
```

**Solutions**:
- Monitor conversation session cleanup
- Check for memory leaks in application logs
- Verify garbage collection is working
- Consider increasing pod memory limits

#### 2. Database Connection Issues

**Problem**: DynamoDB feedback storage fails
```bash
Error: Unable to write to feedback table
```

**Solutions**:
- Verify DynamoDB table exists and is active
- Check IAM permissions for DynamoDB access
- Monitor DynamoDB throttling metrics
- Ensure table has correct TTL configuration

#### 3. Load Balancer Health Check Failures

**Problem**: ALB marks pods as unhealthy
```bash
Health check failed: /health endpoint timeout
```

**Solutions**:
- Verify `/health` endpoint responds quickly
- Check pod startup time and readiness probes
- Monitor EKS pod resource constraints
- Ensure application is binding to port 8000

### Monitoring and Debugging

#### CloudWatch Logs Access

**Application Logs**:
```bash
aws logs tail /aws/eks/your-cluster-name/agent-service --follow
```

**EKS Cluster Logs**:
```bash
aws logs tail /aws/eks/your-cluster-name/cluster --follow
```

**CodeBuild Logs**:
```bash
aws logs tail /aws/codebuild/your-project-name --follow
```

#### Kubernetes Debugging

**Check Pod Status**:
```bash
kubectl get pods -n default
kubectl describe pod <pod-name>
```

**View Pod Logs**:
```bash
kubectl logs <pod-name> -f
```

**Check Service Status**:
```bash
kubectl get svc
kubectl describe svc agent-service
```

#### Health Check Commands

**API Health**:
```bash
curl https://your-api-gateway-url/health
```

**Test Chat Endpoint**:
```bash
curl -X POST https://your-api-gateway-url/chat \
  -H "Content-Type: application/json" \
  -d '{"query": "test", "userId": "debug"}'
```

### Cleanup Issues

#### 1. Stuck Resources During Destroy

**Problem**: `cdk destroy` fails with dependency errors
```bash
Error: Cannot delete VPC - dependencies exist
```

**Solutions**:
- Use deploy.sh destroy mode (handles cleanup automatically)
- Manually delete ALB and security groups if needed
- Wait for EKS cluster deletion to complete (45-60 minutes)
- Check for remaining ENIs and security groups

#### 2. Kubernetes Security Groups

**Problem**: Security groups prevent CDK destruction
```bash
Error: Cannot delete security group - in use
```

**Solutions**:
- Deploy script handles this automatically
- Manual cleanup: Delete k8s-* security groups first
- Wait 10 minutes between cleanup attempts
- Use AWS Console to identify dependent resources

### Getting Additional Help

#### Log Analysis

1. **Enable Debug Logging**: Set log level to DEBUG in application
2. **Collect Relevant Logs**: Gather logs from the time of issue
3. **Check Error Patterns**: Look for recurring error messages
4. **Monitor Resource Usage**: Check CPU, memory, and network metrics

#### Support Information

When reporting issues, include:
- Deployment timestamp and region
- Error messages and stack traces
- CloudWatch log excerpts
- Steps to reproduce the issue
- Expected vs actual behavior

#### Useful AWS Console Links

- **EKS Clusters**: AWS Console → EKS → Clusters
- **CloudWatch Logs**: AWS Console → CloudWatch → Log Groups
- **Bedrock Knowledge Bases**: AWS Console → Bedrock → Knowledge Bases
- **API Gateway**: AWS Console → API Gateway → APIs
- **DynamoDB Tables**: AWS Console → DynamoDB → Tables

#### Emergency Procedures

**Complete System Reset**:
1. Run deploy.sh in destroy mode
2. Wait for complete cleanup (up to 1.5 hours)
3. Verify all resources are deleted
4. Re-run deployment from Step 1

**Partial Recovery**:
1. Identify failing component from logs
2. Update specific configuration
3. Redeploy only affected components
4. Test functionality incrementally
