import * as cdk8s from 'cdk8s';
import * as kplus from 'cdk8s-plus-27';
import { Construct } from 'constructs';

export interface AgentServiceProps {
  iamRoleArn: string;
  namespace: string;
  serviceAccountName: string;
  imageUri: string;
  knowledgeBaseId: string;
  region: string;
  accountId: string;
  logGroupName: string;
  feedbackTableName: string;
}

export class AgentService extends cdk8s.Chart {
  constructor(scope: Construct, id: string, props: AgentServiceProps) {
    super(scope, id);

    const namespace = new kplus.Namespace(this, 'namespace', {
      metadata: { name: props.namespace }
    });

    const serviceAccount = new kplus.ServiceAccount(this, 'service-account', {
      metadata: {
        name: props.serviceAccountName,
        namespace: props.namespace,
        annotations: {
          'eks.amazonaws.com/role-arn': props.iamRoleArn
        }
      }
    });

    const deployment = new kplus.Deployment(this, 'deployment', {
      metadata: {
        name: 'agent-service',
        namespace: props.namespace,
        labels: { app: 'agent-service' }
      },
      replicas: 2,
      serviceAccount,
      containers: [{
        name: 'agent-container',
        image: props.imageUri,
        ports: [{ number: 8000 }],
        envVariables: {
          KNOWLEDGE_BASE_ID: kplus.EnvValue.fromValue(props.knowledgeBaseId),
          AWS_REGION: kplus.EnvValue.fromValue(props.region),
          AWS_ACCOUNT_ID: kplus.EnvValue.fromValue(props.accountId),
          FEEDBACK_TABLE_NAME: kplus.EnvValue.fromValue(props.feedbackTableName),
          LOG_GROUP: kplus.EnvValue.fromValue(props.logGroupName)
        },
        resources: {
          cpu: { request: kplus.Cpu.millis(500), limit: kplus.Cpu.millis(1000) }
        }
      }]
    });

    const service = new kplus.Service(this, 'service', {
      metadata: {
        name: 'agent-service',
        namespace: props.namespace
      },
      selector: deployment,
      ports: [{ port: 80, targetPort: 8000 }]
    });

    new kplus.Ingress(this, 'ingress', {
      metadata: {
        name: 'agent-ingress',
        namespace: props.namespace,
        annotations: {
          'kubernetes.io/ingress.class': 'alb',
          'alb.ingress.kubernetes.io/scheme': 'internet-facing',
          'alb.ingress.kubernetes.io/target-type': 'ip',
          'alb.ingress.kubernetes.io/healthcheck-path': '/health'
        }
      },
      rules: [{
        path: '/',
        pathType: kplus.HttpIngressPathType.PREFIX,
        backend: kplus.IngressBackend.fromService(service)
      }]
    });
  }
}