# Hourly ingestion infrastructure — not deployed

`ingestion.template.json` is plain CloudFormation JSON: an on-demand Node.js 24
Lambda event function, hourly EventBridge Scheduler schedule, two IAM roles,
retained logs, two retained encrypted failure queues, and CloudWatch alarms.
The worker ingests one source: Pitchfork's `best_new_track` category.
The schedule defaults to **DISABLED**. No infrastructure has been provisioned.
No database, artifact bucket, secret, SNS topic, HTTP endpoint, or VPC is created.

## Parameters

| Parameter | Meaning / default |
| --- | --- |
| `ArtifactBucket` | Required existing private S3 bucket in `us-east-2`. |
| `ArtifactKey` | Required existing ZIP key with bundled `index.cjs` at archive root. |
| `ArtifactObjectVersion` | Optional S3 version ID; otherwise use a new key per release. |
| `DatabaseSecretArn` | Required existing same-project secret ARN in `us-east-2`; SecretString JSON contains `DATABASE_URL`. Pass the ARN, never the URL. |
| `SecretRefreshToken` | Non-secret release marker, initially `initial`; change after rotation to force a Lambda configuration update. |
| `ScheduleState` | `DISABLED` by default; enable only after migration, seed and smoke validation. |
| `LogRetentionDays` | 30; allowed: 7, 14, 30, 60, 90, 180, 365 days. |
| `AlarmTopicArn` | Optional existing same-project standard SNS topic in `us-east-2`; empty means alarms without notifications. |
| `PartialFailureFilterPattern` | Defaults to the quoted unstructured term `"partial_failure"`, matching the completion log's status marker. Empty disables the filter and its alarm. |

No connection strings belong in parameter files, outputs, Scheduler input, source
control, or logs. Queue records can contain error details; restrict operator access
and keep those details free of secrets.

## Artifact packaging

The root application build emits `dist/ingestion/index.cjs`, exporting `async handler`
and reading `DATABASE_URL` from the environment. All application modules must be
bundled. This infrastructure work installed no tools or dependencies.

After the separately approved build, package the existing output locally from the
repository root (no upload or deployment):

```sh
zip -j infra/ingestion.zip dist/ingestion/index.cjs
unzip -l infra/ingestion.zip
```

Use a fresh archive: updating an existing ZIP may preserve stale entries. Verify
`index.cjs` is at the root, not inside `dist/ingestion/`. Upload requires separate
authorization. Use immutable keys or S3 versions; overwriting the same key alone
does not tell CloudFormation to update code. The existing bucket must be encrypted,
block public access, require TLS and restrict artifact writers. This stack does not
modify its controls.
`infra/.gitignore` excludes local `*.zip` artifacts; the root ignore file is untouched.

## Manual review and deployment prerequisites

1. Confirm **us-east-2** in **AWS Settings > View all projects > Overview > Additional
   Info > Region**. Select it explicitly for any future change set. All regional
   resources, artifact bucket, secret and optional topic must use this selected
   Region. No credentials/config files or live project state were read here.
   No Region assertion is added under `Rules`: the reviewed official documentation
   did not establish `AWS::Region` support in rule assertions. This template does
   not automatically reject a deployment in another Region; manual confirmation
   and explicitly selecting `us-east-2` remain prerequisites.
2. Verify the project's plan supports the required services, billing/spend status,
   IAM controls, quotas (including one reserved Lambda execution), and Node.js 24
   availability. This is standard on-demand Lambda, with no provisioned concurrency.
3. Review the template/tests and perform CloudFormation schema and security checks
   using separately approved tooling. Review a change set before approving its
   execution. Generated-name IAM roles require `CAPABILITY_IAM`. This document
   does not authorize uploads, invocations, change sets, or provisioning.
4. The deployer/CloudFormation execution role needs stack resource operations,
   scoped `iam:PassRole`, artifact read access and `secretsmanager:GetSecretValue`
   for the supplied secret. Customer-managed artifact/secret keys also require
   decrypt/key-policy permissions on the deployment path. Runtime receives no
   secret-read, artifact-read or KMS permissions.
5. Validate migrations, seed data, TLS database connectivity, pooled connection
   budget, and the administrator-managed Pitchfork source configuration. Authorize a manual smoke run with
   scheduling disabled. Verify idempotency, failure handling, logs and notification
   delivery. Bound feed, review-page and database operations below the 300-second
   function timeout; sequential records from this one source must fit that budget.
6. If supplied, the existing SNS topic needs confirmed subscriptions and a policy
   allowing CloudWatch publishing from this project, scoped to the stack's alarm
   ARNs. An encrypted topic also needs an appropriate KMS key policy. This template
   does not modify the topic. Without it, operators must inspect alarms directly.
7. Only then review an update setting `ScheduleState` to `ENABLED`. Disable it for
   code/database maintenance and wait for accepted/retrying events to drain;
   disabling a schedule does not cancel events already accepted by Lambda.

## Delivery, retries and monitoring

The schedule is `cron(0 * * * ? *)` in UTC with flexible window `OFF`. Scheduler has
minute precision, not a guarantee of execution at exactly second zero. Its Lambda
target invokes asynchronously. The Scheduler role trusts only this project's
dedicated schedule group (the documented SourceArn boundary), can invoke only this
function, and can send only to its delivery queue. Keep unrelated schedules out of
this group. Lambda uses its documented service trust and scoped identity policy;
no unsupported source-condition restriction is added to its execution-role trust.
The log policy intentionally uses `GetAtt IngestionLogGroup.Arn` directly:
[CloudFormation returns a trailing `:*`](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-logs-loggroup.md),
which covers the group's streams for `logs:CreateLogStream` and `logs:PutLogEvents`.
Do not append another wildcard suffix.

| Failure path | Handling |
| --- | --- |
| Scheduler cannot deliver invocation | Up to 3 delivery retries, maximum event age 3,600 seconds, then `DeliveryFailureQueue`. |
| Lambda accepted event but handler fails | Up to 2 function-error retries, maximum event age 3,600 seconds, then an invocation record in `ExecutionFailureQueue` via EventInvokeConfig on `$LATEST`. |
| Lambda throttling / service errors | Async queue may retry until the event age limit; function-error retries are not a total attempt cap. |
| Lambda cannot write failure destination | `DestinationDeliveryFailures` alarm; an empty queue does not prove no failures. |

Both queues are standard queues with SSE-SQS encryption, TLS-only access, 14-day
message retention and no automatic consumers/replay loops. SSE-SQS needs no runtime
KMS permissions. Scheduler payloads use default AWS-owned encryption. The Lambda
on-failure destination intentionally replaces a separate `DeadLetterConfig`;
configuring both would duplicate failure notifications.

Both delivery layers are **at least once**. Reserved concurrency one limits this
function's simultaneous executions. The application separately acquires a source
lease and fences database writes with its token and expiry, so stale workers cannot
commit after losing ownership. A busy or disabled source returns `skipped`.
Neither mechanism deduplicates delivered events; database uniqueness and idempotent
writes remain necessary. Track records commit individually, so earlier successful
records remain committed if later records are rejected or the run fails. Retries
can revisit those records. The handler logs its completion status and throws a
sanitized error code on `partial_failure` or `failed`, allowing Lambda retry and
destination handling without exposing raw exception messages.

Alarms cover Lambda errors, throttles, dropped async events, destination delivery
failures, both queues' visible messages, Scheduler target errors/dropped invocations,
and the partial-failure log marker. They use five-minute windows, Sum for failures
and Maximum for queue depth, threshold one, and non-breaching missing data. This
cautious default alerts on the first failure rather than waiting for repeated runs
to fail. SNS actions notify on transitions to alarm and recovery, not repeatedly
while an alarm remains in ALARM.

The handler calls `console.log(JSON.stringify(record))` with `event:
"ingestion_completed"`, `source: "pitchfork"`, `category: "best_new_track"` and
`status: "succeeded" | "partial_failure" | "failed" | "skipped"`. Completed run
records include `runId`, counts and `errors: [{code, sourceUrl}]`; early failures
and lease-related skips may omit those fields. Lambda's configured text format
adds a timestamp, request ID and level before the serialized JSON.
[AWS documents this prefix](https://docs.aws.amazon.com/lambda/latest/dg/monitoring-cloudwatchlogs-logformat.html)
and states that [JSON field patterns require a JSON-only event](https://docs.aws.amazon.com/cdk/api/v1/dotnet/api/Amazon.CDK.AWS.Logs.NamespaceDoc.html).
Therefore the filter uses the [quoted unstructured term](https://docs.aws.amazon.com/AmazonCloudWatch/latest/logs/FilterAndPatternSyntax.html)
`"partial_failure"` rather than assuming `$.status` parses appended JSON. Keep
`LogFormat: Text`; no handler changes or JSON log envelope assumptions are needed.
The term matches anywhere in the line, not exclusively the status field; avoid
reusing it in unrelated logs. Ordinary `failed` runs remain covered by Lambda's
Errors alarm. Keep the marker aligned with the handler and validate it against
real logs before enabling. No runtime CloudWatch API calls or logging dependencies
are needed.

These alarms do not prove hourly freshness or detect silent no-op runs. Inspect
application run records/latest successful ingestion, per-record rejections, source
lease/skip outcomes, queue age and
logs. A future run-record freshness check needs an explicit application contract.
Queue metrics are approximate; visible-message alarms may clear during inspection.

## Secrets and networking

The versionless dynamic reference resolves the secret's `DATABASE_URL` JSON key
when CloudFormation creates/updates the Lambda configuration. Lambda encrypts the
environment at rest by default; appropriately privileged configuration readers can
still see it, so restrict those permissions. The worker does not fetch the secret
at invocation time and no secret value is output by the stack.

**Secret rotation alone does not refresh the environment.** Change the non-secret
`SecretRefreshToken` in a reviewed stack update to alter the Lambda configuration
and cause CloudFormation to resolve the reference again. Verify the new connection
and coordinate credential overlap with in-flight runs before retiring the old
credential. A no-change update or restart alone is insufficient. Never put a secret
value in the refresh token.

No VPC is attached. Lambda has public outbound access for the Pitchfork feed/review pages and a publicly
reachable TLS database, with no public inbound endpoint. A private-only database
requires a separate VPC/subnet/security-group design, Lambda network permissions,
and outbound connectivity (often NAT with extra cost). Public egress is not SSRF
protection; source URLs must remain administrator-controlled with application URL
safety checks.

## Cost and cleanup

When enabled, expect roughly 24 scheduled runs/day plus retries. Costs depend on
Lambda duration/memory, logs, custom metrics, alarms, queue requests, existing
secret/artifact/database storage and optional SNS delivery. Alarms and stored data
may cost money even with scheduling disabled. No pricing or Free Tier entitlement
was assumed; no NAT, dedicated KMS key, database or provisioned concurrency is added.

For separately authorized cleanup: disable scheduling, drain accepted events,
investigate/export or replay required failure records, then review stack deletion.
Both queues and the log group have deletion/replacement policies of `Retain`; they
survive as separately managed resources and can continue to incur charges. Queue
messages still expire after 14 days and logs obey their configured retention.
Delete retained resources separately only after review. Existing bucket, artifacts,
secret, database and topic are never deleted by this stack. Retained log-group names
may require import/renaming before reusing the same stack name.

## Local checks and limitations

Run from repository root:

```sh
node --test infra/test/*.test.mjs
```

These dependency-free checks parse JSON and verify wiring/security invariants and
dependency cycles. Log fixtures cover all four statuses with a representative
Lambda text prefix; they verify emitted content and marker presence, not AWS's
filtering engine. They are not a full CloudFormation schema validator or a live
integration test. `sam`, `cfn-lint`, `cfn-validate` and `cfn-guard` were unavailable
and were not installed or run. No live AWS validation/deployment, credential access,
uploads or provisioning occurred.

Official references: [Node.js 24 on Lambda](https://aws.amazon.com/blogs/compute/node-js-24-runtime-now-available-in-aws-lambda/),
[Scheduler Lambda target](https://docs.aws.amazon.com/lambda/latest/dg/with-eventbridge-scheduler.html),
[Scheduler trust boundary](https://docs.aws.amazon.com/scheduler/latest/UserGuide/cross-service-confused-deputy-prevention.html),
[Scheduler CloudFormation](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-scheduler-schedule.md),
[EventInvokeConfig](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-lambda-eventinvokeconfig.md),
[Lambda Destinations](https://aws.amazon.com/blogs/compute/introducing-aws-lambda-destinations/),
and [secret reference updates](https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/dynamic-references-secretsmanager.md).

