import * as cdk from 'aws-cdk-lib';
import * as eks from 'aws-cdk-lib/aws-eks';
import * as iam from 'aws-cdk-lib/aws-iam';
import { Construct } from 'constructs';

export interface AwsLoadBalancerControllerProps {
  eksCluster: eks.ICluster;
}

export class AwsLoadBalancerController extends Construct {
  constructor(scope: Construct, id: string, props: AwsLoadBalancerControllerProps) {
    super(scope, id);

    const awsLbControllerServiceAccount = props.eksCluster.addServiceAccount('aws-load-balancer-controller', {
      name: 'aws-load-balancer-controller',
      namespace: 'kube-system'
    });

    awsLbControllerServiceAccount.addToPrincipalPolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'iam:CreateServiceLinkedRole',
        'ec2:Describe*',
        'ec2:CreateSecurityGroup',
        'ec2:CreateTags',
        'ec2:DeleteTags',
        'ec2:AuthorizeSecurityGroupIngress',
        'ec2:RevokeSecurityGroupIngress',
        'elasticloadbalancing:*',
        'acm:ListCertificates',
        'acm:DescribeCertificate',
        'iam:ListServerCertificates',
        'iam:GetServerCertificate',
        'waf-regional:*',
        'wafv2:*',
        'shield:*'
      ],
      resources: ['*']
    }));

    const stack = cdk.Stack.of(this);
    props.eksCluster.addHelmChart('aws-load-balancer-controller', {
      chart: 'aws-load-balancer-controller',
      repository: 'https://aws.github.io/eks-charts',
      namespace: 'kube-system',
      values: {
        clusterName: props.eksCluster.clusterName,
        region: stack.region,
        vpcId: props.eksCluster.vpc.vpcId,
        serviceAccount: {
          create: false,
          name: 'aws-load-balancer-controller'
        }
      }
    });
  }
}