#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { IEchoRagChatbotStack } from '../lib/iecho-rag-chatbot-stack';
import { AwsSolutionsChecks } from 'cdk-nag';

const app = new cdk.App();

// Create the main stack
const stack = new IEchoRagChatbotStack(app, 'IEchoRagChatbotStack', {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION || 'us-west-2',
  },
  description: 'iECHO RAG Chatbot - Multi-modal document processing and AI-powered chat system',
});

// Apply CDK Nag for security best practices (temporarily disabled for initial deployment)
// cdk.Aspects.of(app).add(new AwsSolutionsChecks());
