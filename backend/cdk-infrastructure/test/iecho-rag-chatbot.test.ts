import * as cdk from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import * as IEchoRagChatbot from '../lib/iecho-rag-chatbot-stack';

test('Stack creates required resources', () => {
  const app = new cdk.App();
  const stack = new IEchoRagChatbot.IEchoRagChatbotStack(app, 'MyTestStack');
  const template = Template.fromStack(stack);

  // Test that S3 buckets are created
  template.hasResourceProperties('AWS::S3::Bucket', {
    BucketEncryption: {
      ServerSideEncryptionConfiguration: [{
        ServerSideEncryptionByDefault: {
          SSEAlgorithm: 'AES256'
        }
      }]
    }
  });

  // Test that DynamoDB table is created
  template.hasResourceProperties('AWS::DynamoDB::Table', {
    BillingMode: 'PAY_PER_REQUEST',
    AttributeDefinitions: [
      {
        AttributeName: 'userId',
        AttributeType: 'S'
      },
      {
        AttributeName: 'timestamp',
        AttributeType: 'S'
      }
    ]
  });

  // Test that Lambda functions are created
  template.resourceCountIs('AWS::Lambda::Function', 2);

  // Test that API Gateway is created
  template.hasResourceProperties('AWS::ApiGateway::RestApi', {
    Name: 'iecho-rest-api'
  });

  // Test that EKS cluster is created
  template.hasResourceProperties('AWS::EKS::Cluster', {
    Name: 'iecho-agent-cluster'
  });
});
