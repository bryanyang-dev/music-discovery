import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(new URL('../ingestion.template.json', import.meta.url), 'utf8');
const template = JSON.parse(source);
const { Resources: resources, Parameters: parameters, Conditions: conditions } = template;
const props = (id) => resources[id].Properties;
const ref = (id) => ({ Ref: id });
const arn = (id) => ({ 'Fn::GetAtt': [id, 'Arn'] });
const statements = (id) => props(id).Policies.flatMap((p) => p.PolicyDocument.Statement);
const alarms = Object.values(resources).filter((r) => r.Type === 'AWS::CloudWatch::Alarm');

test('JSON is small enough for an inline template and preserves design context', () => {
  assert.equal(template.AWSTemplateFormatVersion, '2010-09-09');
  assert.ok(Buffer.byteLength(source) < 51200);
  assert.ok(Buffer.byteLength(template.Description) <= 1024);
  assert.equal(template.Metadata.AWSToolsMetrics.AWSAgentToolkit, 'aws-cloudformation@3');
  for (const resource of Object.values(resources)) {
    assert.ok(resource.Metadata['com.aws.cloudformation.Context'].why);
  }
});

test('hourly schedule defaults disabled, in UTC, without flexible delivery window', () => {
  const schedule = props('HourlySchedule');
  assert.equal(parameters.ScheduleState.Default, 'DISABLED');
  assert.deepEqual(parameters.ScheduleState.AllowedValues, ['DISABLED', 'ENABLED']);
  assert.deepEqual(schedule.State, ref('ScheduleState'));
  assert.equal(schedule.ScheduleExpression, 'cron(0 * * * ? *)');
  assert.equal(schedule.ScheduleExpressionTimezone, 'UTC');
  assert.deepEqual(schedule.FlexibleTimeWindow, { Mode: 'OFF' });
  assert.deepEqual(schedule.GroupName, ref('ScheduleGroup'));
  assert.deepEqual(schedule.Target.Arn, arn('IngestionFunction'));
  assert.deepEqual(schedule.Target.RoleArn, arn('SchedulerExecutionRole'));
  assert.deepEqual(JSON.parse(schedule.Target.Input), { source: 'music-discovery.scheduler' });
  assert.ok(resources.HourlySchedule.DependsOn.includes('AsyncInvocationConfig'));
});

test('function uses on-demand Node 24 and root CommonJS handler bundle', () => {
  const fn = props('IngestionFunction');
  assert.equal(fn.Runtime, 'nodejs24.x');
  assert.equal(fn.Handler, 'index.handler');
  assert.equal(fn.PackageType, 'Zip');
  assert.equal(fn.ReservedConcurrentExecutions, 1);
  assert.equal(fn.Timeout, 300);
  assert.deepEqual(fn.Architectures, ['x86_64']);
  assert.deepEqual(fn.Code.S3Bucket, ref('ArtifactBucket'));
  assert.deepEqual(fn.Code.S3Key, ref('ArtifactKey'));
  assert.deepEqual(fn.Code.S3ObjectVersion, {
    'Fn::If': ['HasArtifactVersion', ref('ArtifactObjectVersion'), ref('AWS::NoValue')],
  });
  assert.deepEqual(conditions.HasArtifactVersion, {
    'Fn::Not': [{ 'Fn::Equals': [ref('ArtifactObjectVersion'), ''] }],
  });
  assert.ok(!fn.VpcConfig);
  assert.ok(!fn.ProvisionedConcurrencyConfig);
  assert.ok(!fn.DeadLetterConfig, 'failure destination is the single execution failure mechanism');
});

test('secret uses only an ARN parameter and a versionless deployment-time reference', () => {
  assert.deepEqual(props('IngestionFunction').Environment.Variables, {
    DATABASE_URL: { 'Fn::Sub': '{{resolve:secretsmanager:${DatabaseSecretArn}:SecretString:DATABASE_URL}}' },
    SECRET_REFRESH_TOKEN: ref('SecretRefreshToken'),
  });
  assert.ok(!('DATABASE_URL' in parameters));
  assert.ok(!('Default' in parameters.DatabaseSecretArn));
  assert.match(parameters.DatabaseSecretArn.AllowedPattern, /us-east-2/);
  assert.doesNotMatch(JSON.stringify(template.Outputs), /DATABASE_URL|DatabaseSecretArn/);
  assert.doesNotMatch(source, /postgres(?:ql)?:\/\/|AKIA[A-Z0-9]{16}|-----BEGIN/);
});

test('delivery and execution retry paths use different queues', () => {
  const target = props('HourlySchedule').Target;
  assert.deepEqual(target.DeadLetterConfig, { Arn: arn('DeliveryFailureQueue') });
  assert.deepEqual(target.RetryPolicy, { MaximumEventAgeInSeconds: 3600, MaximumRetryAttempts: 3 });
  const config = props('AsyncInvocationConfig');
  assert.deepEqual(config.FunctionName, ref('IngestionFunction'));
  assert.equal(config.Qualifier, '$LATEST');
  assert.equal(config.MaximumRetryAttempts, 2);
  assert.equal(config.MaximumEventAgeInSeconds, 3600);
  assert.deepEqual(config.DestinationConfig, { OnFailure: { Destination: arn('ExecutionFailureQueue') } });
});

test('failure queues are encrypted standard queues with retained investigation data', () => {
  for (const id of ['DeliveryFailureQueue', 'ExecutionFailureQueue']) {
    const queue = resources[id];
    assert.equal(queue.Type, 'AWS::SQS::Queue');
    assert.equal(queue.Properties.SqsManagedSseEnabled, true);
    assert.equal(queue.Properties.MessageRetentionPeriod, 14 * 24 * 60 * 60);
    assert.ok(!queue.Properties.FifoQueue);
    assert.ok(!queue.Properties.RedrivePolicy);
    assert.equal(queue.DeletionPolicy, 'Retain');
    assert.equal(queue.UpdateReplacePolicy, 'Retain');
  }
  const policy = props('FailureQueuePolicy');
  assert.deepEqual(policy.Queues, [ref('DeliveryFailureQueue'), ref('ExecutionFailureQueue')]);
  assert.deepEqual(policy.PolicyDocument.Statement, [{
    Effect: 'Deny', Principal: '*', Action: 'sqs:*',
    Resource: [arn('DeliveryFailureQueue'), arn('ExecutionFailureQueue')],
    Condition: { Bool: { 'aws:SecureTransport': 'false' } },
  }]);
});

test('runtime role has only log writes and execution destination sends', () => {
  assert.deepEqual(props('IngestionFunction').Role, arn('LambdaExecutionRole'));
  assert.deepEqual(props('LambdaExecutionRole').AssumeRolePolicyDocument.Statement, [{
    Effect: 'Allow', Principal: { Service: 'lambda.amazonaws.com' }, Action: 'sts:AssumeRole',
  }]);
  assert.deepEqual(statements('LambdaExecutionRole'), [{
    Effect: 'Allow', Action: ['logs:CreateLogStream', 'logs:PutLogEvents'], Resource: arn('IngestionLogGroup'),
  }, { Effect: 'Allow', Action: 'sqs:SendMessage', Resource: arn('ExecutionFailureQueue') }]);
  assert.ok(!props('LambdaExecutionRole').ManagedPolicyArns);
  // Official AWS::Logs::LogGroup return schema includes :* in Arn, so the
  // GetAtt above covers streams directly; appending another :* would be wrong.
});

test('Scheduler trust uses the exact group ARN and project, with narrow permissions', () => {
  assert.deepEqual(props('SchedulerExecutionRole').AssumeRolePolicyDocument.Statement, [{
    Effect: 'Allow', Principal: { Service: 'scheduler.amazonaws.com' }, Action: 'sts:AssumeRole',
    Condition: {
      StringEquals: { 'aws:SourceAccount': ref('AWS::AccountId') },
      ArnEquals: { 'aws:SourceArn': arn('ScheduleGroup') },
    },
  }]);
  assert.deepEqual(statements('SchedulerExecutionRole'), [
    { Effect: 'Allow', Action: 'lambda:InvokeFunction', Resource: arn('IngestionFunction') },
    { Effect: 'Allow', Action: 'sqs:SendMessage', Resource: arn('DeliveryFailureQueue') },
  ]);
});

test('all identity Allow statements avoid wildcard actions/resources and managed policies', () => {
  for (const id of ['LambdaExecutionRole', 'SchedulerExecutionRole']) {
    assert.ok(!props(id).ManagedPolicyArns);
    assert.ok(!props(id).RoleName, 'CloudFormation generates IAM names');
    for (const statement of statements(id)) {
      assert.equal(statement.Effect, 'Allow');
      for (const action of [statement.Action].flat()) assert.ok(!action.includes('*'));
      assert.notEqual(statement.Resource, '*');
    }
  }
});

test('logs have bounded retention, survive deletion and are explicitly wired to Lambda', () => {
  assert.equal(parameters.LogRetentionDays.Default, 30);
  assert.deepEqual(props('IngestionLogGroup').RetentionInDays, ref('LogRetentionDays'));
  assert.equal(resources.IngestionLogGroup.DeletionPolicy, 'Retain');
  assert.equal(resources.IngestionLogGroup.UpdateReplacePolicy, 'Retain');
  assert.deepEqual(props('IngestionFunction').LoggingConfig, { LogFormat: 'Text', LogGroup: ref('IngestionLogGroup') });
});

test('alarms cover both delivery layers and queue backlogs with correct dimensions', () => {
  for (const metric of ['Errors', 'Throttles', 'DestinationDeliveryFailures', 'AsyncEventsDropped']) {
    const alarm = alarms.find((r) => r.Properties.Namespace === 'AWS/Lambda' && r.Properties.MetricName === metric);
    assert.ok(alarm, metric);
    assert.deepEqual(alarm.Properties.Dimensions, [{ Name: 'FunctionName', Value: ref('IngestionFunction') }]);
  }
  for (const id of ['DeliveryFailureQueue', 'ExecutionFailureQueue']) {
    const alarm = props(id + 'Alarm');
    assert.equal(alarm.Namespace, 'AWS/SQS');
    assert.equal(alarm.MetricName, 'ApproximateNumberOfMessagesVisible');
    assert.equal(alarm.Statistic, 'Maximum');
    assert.deepEqual(alarm.Dimensions, [{ Name: 'QueueName', Value: { 'Fn::GetAtt': [id, 'QueueName'] } }]);
  }
  for (const metric of ['TargetErrorCount', 'InvocationDroppedCount']) {
    const alarm = alarms.find((r) => r.Properties.Namespace === 'AWS/Scheduler' && r.Properties.MetricName === metric);
    assert.ok(alarm, metric);
    assert.deepEqual(alarm.Properties.Dimensions, [{ Name: 'ScheduleGroup', Value: ref('ScheduleGroup') }]);
  }
});

test('existing SNS actions are optional on all alarms and never create a topic', () => {
  assert.equal(parameters.AlarmTopicArn.Default, '');
  assert.deepEqual(conditions.HasAlarmTopic, { 'Fn::Not': [{ 'Fn::Equals': [ref('AlarmTopicArn'), ''] }] });
  assert.ok(alarms.length >= 9);
  for (const { Properties: alarm } of alarms) {
    const expected = { 'Fn::If': ['HasAlarmTopic', [ref('AlarmTopicArn')], ref('AWS::NoValue')] };
    assert.deepEqual(alarm.AlarmActions, expected);
    assert.deepEqual(alarm.OKActions, expected);
    assert.equal(alarm.Period, 300);
    assert.equal(alarm.Threshold, 1);
    assert.equal(alarm.TreatMissingData, 'notBreaching');
    assert.equal(alarm.EvaluationPeriods, 1);
  }
});

test('partial failure metric is optional and matches its alarm without dimensions', () => {
  assert.equal(parameters.PartialFailureFilterPattern.Default, '"partial_failure"');
  assert.deepEqual(conditions.HasPartialFailureFilter, {
    'Fn::Not': [{ 'Fn::Equals': [ref('PartialFailureFilterPattern'), ''] }],
  });
  assert.equal(resources.PartialFailureMetricFilter.Condition, 'HasPartialFailureFilter');
  assert.equal(resources.PartialFailureAlarm.Condition, 'HasPartialFailureFilter');
  const filter = props('PartialFailureMetricFilter');
  assert.deepEqual(filter.FilterPattern, ref('PartialFailureFilterPattern'));
  assert.deepEqual(filter.LogGroupName, ref('IngestionLogGroup'));
  const [metric] = filter.MetricTransformations;
  assert.deepEqual(props('PartialFailureAlarm').Namespace, metric.MetricNamespace);
  assert.equal(props('PartialFailureAlarm').MetricName, metric.MetricName);
  assert.equal(metric.MetricValue, '1');
  assert.ok(!metric.Dimensions);
});

test('partial failure marker occurs in the implemented JSON log shape despite Lambda text prefix', () => {
  assert.equal(props('IngestionFunction').LoggingConfig.LogFormat, 'Text');
  // Verify representative log content, not CloudWatch's filtering implementation.
  // Official filter syntax treats this quoted pattern as an unstructured term.
  const marker = parameters.PartialFailureFilterPattern.Default.slice(1, -1);
  const prefix = '2026-11-10T00:00:00.000Z\t00000000-0000-4000-8000-000000000000\tINFO\t';
  for (const status of ['succeeded', 'partial_failure', 'failed', 'skipped']) {
    const identity = {
      event: 'ingestion_completed', source: 'pitchfork', category: 'best_new_track',
      status,
    };
    const record = status === 'skipped' ? { ...identity, reason: 'busy_or_disabled' } : {
      ...identity, runId: '00000000-0000-4000-8000-000000000001', notModified: false,
      found: 2, inserted: 1, updated: 0, unchanged: 0,
      rejected: status === 'partial_failure' ? 1 : 0,
      errors: status === 'partial_failure' || status === 'failed'
        ? [{ code: 'INVALID_METADATA', sourceUrl: 'https://pitchfork.com/reviews/tracks/example/' }] : [],
    };
    const line = prefix + JSON.stringify(record);
    assert.throws(() => JSON.parse(line), SyntaxError, 'the complete text event is not a JSON object');
    assert.deepEqual(JSON.parse(line.slice(prefix.length)), record);
    assert.equal(line.includes(marker), status === 'partial_failure');
  }
  const earlyFailure = prefix + JSON.stringify({ event: 'ingestion_completed',
    source: 'pitchfork', category: 'best_new_track', status: 'failed',
    errors: [{ code: 'DATABASE_ERROR', sourceUrl: null }] });
  assert.ok(!earlyFailure.includes(marker), 'an early sanitized error is not a partial-failure marker');
  assert.ok(!('Rules' in template), 'Region confirmation stays a manual prerequisite; no unverified Rules assertion');
});

test('resource set includes no public ingress, database, artifact bucket or dependencies', () => {
  const allowed = new Set(['AWS::Lambda::Function', 'AWS::Lambda::EventInvokeConfig',
    'AWS::IAM::Role', 'AWS::Scheduler::Schedule', 'AWS::Scheduler::ScheduleGroup',
    'AWS::SQS::Queue', 'AWS::SQS::QueuePolicy', 'AWS::Logs::LogGroup',
    'AWS::Logs::MetricFilter', 'AWS::CloudWatch::Alarm']);
  for (const resource of Object.values(resources)) assert.ok(allowed.has(resource.Type), resource.Type);
  assert.equal(Object.values(resources).filter((r) => r.Type === 'AWS::Lambda::Function').length, 1);
});

test('all references resolve locally and the creation dependency graph is acyclic', () => {
  const graph = new Map(Object.keys(resources).map((id) => [id, new Set()]));
  const check = (target, owner) => {
    if (target.startsWith('AWS::')) return;
    assert.ok(resources[target] || parameters[target], `unresolved ${target} in ${owner}`);
    if (resources[target]) graph.get(owner)?.add(target);
  };
  const walk = (value, owner) => {
    if (!value || typeof value !== 'object') return;
    if (value.Ref) check(value.Ref, owner);
    if (value['Fn::GetAtt']) check(value['Fn::GetAtt'][0], owner);
    if (value['Fn::If']) assert.ok(conditions[value['Fn::If'][0]]);
    if (typeof value['Fn::Sub'] === 'string') {
      for (const [, variable] of value['Fn::Sub'].matchAll(/\$\{([^}]+)\}/g)) check(variable.split('.')[0], owner);
    }
    for (const nested of Object.values(value)) walk(nested, owner);
  };
  for (const [id, resource] of Object.entries(resources)) {
    walk(resource.Properties, id);
    if (resource.Condition) assert.ok(conditions[resource.Condition]);
    for (const dependency of [resource.DependsOn ?? []].flat()) {
      assert.ok(resources[dependency]);
      graph.get(id).add(dependency);
    }
  }
  walk(template.Outputs);
  const done = new Set();
  const visiting = new Set();
  const visit = (id) => {
    assert.ok(!visiting.has(id), `dependency cycle at ${id}`);
    if (done.has(id)) return;
    visiting.add(id);
    for (const dependency of graph.get(id)) visit(dependency);
    visiting.delete(id);
    done.add(id);
  };
  for (const id of graph.keys()) visit(id);
});
