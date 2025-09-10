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
- Add specific IAM permissions from [Deployment Guide](./deploymentGuide.md)
- Ensure IAM user has `iam:CreateRole` and `iam:PutRolePolicy` permissions
- Verify CodeBuild permissions are correctly set
- Check AWS region matches your configuration

#### 4. IAM Role Creation Issues

**Problem**: CodeBuild service role creation fails
```bash
Error: CodeBuild is not authorized to perform: sts:AssumeRole
```

**Solutions**:
- Wait 10 seconds after role creation (handled automatically in deploy.sh)
- Verify IAM permissions for role creation
- Check trust policy is correctly configured
- Ensure role propagation has completed

#### 5. Frontend Build Failures

**Problem**: Frontend deployment fails in CodeBuild
```bash
Error: YAML_FILE_ERROR or buildspec syntax issues
```

**Solutions**:
- Check `buildspec-frontend.yml` syntax
- Verify Amplify app was created without GitHub integration
- Ensure environment variables are passed correctly
- Check Next.js build process in logs

#### 6. Amplify Deployment Issues

**Problem**: Amplify deployment fails with zip upload errors
```bash
Error: Operation not supported. App is already connected a repository.
```

**Solutions**:
- Ensure Amplify app is created without GitHub repository connection
- Verify CDK creates Amplify app correctly (no repository/accessToken)
- Check buildspec uses zip upload method, not GitHub integration
- Confirm Amplify branch creation succeeds

### Runtime Issues

#### 7. API Gateway 502/504 Errors

**Problem**: API returns server errors
```bash
{"message": "Internal server error"}
```

**Solutions**:
- Check EKS pod status: `kubectl get pods -n default`
- Verify ALB target group health in AWS Console
- Check application logs in CloudWatch
- Ensure Knowledge Base is accessible from EKS

#### 8. Knowledge Base Connection Issues

**Problem**: Chat responses indicate KB connection problems
```bash
Error: Unable to retrieve from knowledge base
```

**Solutions**:
- Verify Knowledge Base ID in environment variables
- Check IAM role permissions for Bedrock access
- Ensure Knowledge Base data source is synced
- Test Knowledge Base directly in Bedrock Console

#### 9. Frontend API Connection Issues

**Problem**: Frontend can't connect to backend API
```bash
Network Error or CORS issues
```

**Solutions**:
- Verify `NEXT_PUBLIC_API_BASE_URL` in `.env.local`
- Check API Gateway CORS configuration
- Ensure API Gateway URL is correct and accessible
- Test API endpoints directly with curl

### Cleanup Issues

#### 10. CloudFormation Stack Deletion Failures

**Problem**: Stack deletion fails due to resource dependencies
```bash
Error: Resource has a dependent object
```

**Solutions**:
- Run `./cleanup.sh` which handles dependencies automatically
- Script will clean security groups and retry CDK destroy
- Check for manual resources that need deletion
- Verify EKS cluster deletion completes

#### 11. Security Group Dependency Issues

**Problem**: VPC deletion fails due to security group references
```bash
Error: DependencyViolation - resource has a dependent object
```

**Solutions**:
- Cleanup script handles this automatically with retry logic
- First attempts CDK destroy, then cleans security groups if needed
- Waits for network interface cleanup before retrying
- Manual cleanup: remove security group rules in AWS Console

#### 12. EKS Cluster Stuck in Deleting State

**Problem**: EKS cluster deletion takes very long or gets stuck
```bash
Cluster status: DELETING for extended period
```

**Solutions**:
- EKS deletion can take 30-45 minutes - this is normal
- Check for stuck Fargate profiles or node groups
- Verify no manual resources are preventing deletion
- CDK handles proper deletion order automatically

## Debugging Steps

### 1. Check Deployment Logs

**CodeBuild Logs**:
```bash
# Backend deployment logs
aws logs tail /aws/codebuild/iecho-rag-[timestamp]-main --follow

# Frontend deployment logs
aws logs tail /aws/codebuild/iecho-rag-[timestamp]-frontend --follow
```

**Application Logs**:
```bash
# EKS application logs
aws logs tail /aws/containerinsights/[cluster-name]/application --follow

# API Gateway logs
aws logs tail API-Gateway-Execution-Logs_[api-id]/prod --follow
```

### 2. Verify Infrastructure Status

**CloudFormation Stack**:
```bash
aws cloudformation describe-stacks --stack-name AgentFargateStack
aws cloudformation describe-stack-events --stack-name AgentFargateStack
```

**EKS Cluster**:
```bash
aws eks describe-cluster --name [cluster-name]
kubectl get pods -n default
kubectl get services -n default
```

**Amplify App**:
```bash
aws amplify list-apps
aws amplify get-app --app-id [app-id]
```

### 3. Test Individual Components

**API Gateway**:
```bash
curl https://[api-gateway-url]/health
curl -X POST https://[api-gateway-url]/chat \
  -H "Content-Type: application/json" \
  -d '{"query": "test", "userId": "test", "sessionId": "test"}'
```

**Knowledge Base**:
- Test directly in AWS Bedrock Console
- Verify data source sync status
- Check embeddings model configuration

**Frontend**:
- Test locally with `npm run dev`
- Check browser console for errors
- Verify API URL configuration

## Performance Issues

### 1. Slow Response Times

**Problem**: API responses are slow (>10 seconds)

**Solutions**:
- Check EKS pod resource allocation
- Verify Knowledge Base performance in Bedrock Console
- Monitor CloudWatch metrics for bottlenecks
- Consider scaling EKS Fargate resources

### 2. High Memory Usage

**Problem**: Application pods restarting due to memory issues

**Solutions**:
- Check pod memory limits in Kubernetes deployment
- Monitor memory usage in CloudWatch Container Insights
- Adjust Fargate profile resource allocation if needed
- Review application memory optimization

## Getting Additional Help

### Log Locations
- **CodeBuild**: `/aws/codebuild/[project-name]`
- **EKS Cluster**: `/aws/eks/[cluster-name]/cluster`
- **Application**: `/aws/containerinsights/[cluster-name]/application`
- **Lambda**: `/aws/lambda/[function-name]`
- **API Gateway**: `API-Gateway-Execution-Logs_[api-id]/prod`

### AWS Console Resources
- **CloudFormation**: Monitor stack events and resources
- **EKS**: Check cluster, node groups, and Fargate profiles
- **CodeBuild**: Review build history and logs
- **Amplify**: Monitor app deployments and builds
- **CloudWatch**: View all logs and metrics

### Support Channels
- Check AWS service health dashboard
- Review AWS documentation for specific services
- Use AWS Support if you have a support plan
- Check GitHub repository for known issues
