# Infrastructure status

## Current workflow: Lambda console

The existing `musicRssFetcher` function in `us-east-2` is configured directly in the
AWS Lambda console. Its environment variables were set manually:

| Variable              | Value                                        |
| --------------------- | -------------------------------------------- |
| `DATABASE_URL`        | Private runtime PostgreSQL connection string |
| `NODE_EXTRA_CA_CERTS` | `/var/task/prod-ca-2021.crt`                 |

Maintain credentials, timeout, execution role, networking, concurrency, triggers,
log retention and destinations in the console. A 300-second timeout is recommended;
other live settings are not inferred from repository files. Credential rotation
requires updating `DATABASE_URL` in the console and testing connectivity.
The handler reads the environment; it does not fetch Secrets Manager values.

`pnpm upload:ingestion` updates ingestion code only, packaging `index.cjs` and the existing
public CA certificate at the ZIP root. It preserves environment variables and
other configuration. `pnpm build:lambda` builds locally without updating AWS.
See [release configuration](../docs/operations.md#configuration-and-releases) for target/profile options and
[operations](../docs/operations.md) for verification and troubleshooting.

There is no active CDK setup. The canceled CDK installation added no dependencies.
Do not deploy infrastructure merely to upload code or change an environment value.

## Separate console-created track matcher

The `trackMatcher` function is managed in the Lambda console independently of
ingestion. `pnpm upload:matcher` uses the target ARN, region and profile from
[`scripts/lambda-targets.sh`](../scripts/lambda-targets.sh); explicit arguments
can override those defaults. The command
packages `dist/track-matcher/index.cjs` and the CA at the ZIP root. It updates code
only. Configure its Spotify environment, timeout and database grants/RLS using
[the matcher operations guide](../docs/operations.md#track-matcher-configuration-and-contract). No matcher
resources or ingestion-to-matcher trigger are defined by the retained template.

Use `pnpm upload:lambda` for both apps in sequence with the shared defaults, or
override them with `<ingestion-function> <matcher-function> <region> [aws-profile]`.
Failure stops later uploads and does not roll back an earlier successful upload.

## Retained CloudFormation design: not deployed

`ingestion.template.json` and `test/ingestion.test.mjs` are retained for a possible
future hourly worker. They do not manage or adopt the console-created function.
The template creates a separate generated-name Lambda, execution roles, retained
logs, an hourly UTC schedule (disabled by default), two failure queues and alarms.
It assumes existing S3 artifacts and a Secrets Manager secret containing a
`DATABASE_URL` JSON key; optional SNS notifications need an existing topic.
These are template requirements, not prerequisites for the current upload task.

| Template parameter                                       | Purpose                                                      |
| -------------------------------------------------------- | ------------------------------------------------------------ |
| `ArtifactBucket`, `ArtifactKey`, `ArtifactObjectVersion` | Existing code ZIP; use immutable keys or S3 versions         |
| `DatabaseSecretArn`, `SecretRefreshToken`                | Deployment-time secret reference and explicit refresh marker |
| `ScheduleState`                                          | `DISABLED` by default                                        |
| `LogRetentionDays`                                       | 30 by default, for the template's log group only             |
| `AlarmTopicArn`                                          | Optional existing SNS topic                                  |
| `PartialFailureFilterPattern`                            | Optional quoted `"partial_failure"` log marker               |

Before any future deployment, review these gaps against the current application:

- Plan how to adopt or replace the existing function; deploying this template alone
  creates another function and does not capture manual configuration.
- The retained Scheduler payload lacks the required `sourceKey`; choose a
  registered source key and update that payload before deploying this design.
- The template does not set `NODE_EXTRA_CA_CERTS`. Add trusted CA configuration and
  include `prod-ca-2021.crt` in its S3 artifact before using this database setup.
- Track upserts are enabled in application code; verify hosted writes and runtime
  grants/RLS before rollout. `partial_failure` is returned and logged, not thrown;
  only terminal failures trigger Lambda function-error retries.
- Completion logs use `{event, requestId, result, level}` with `result.status` and
  nested counts. Template log fixtures are representative, not emitted-handler
  integration tests; validate filters against actual CloudWatch events.
- Confirm account/region, CloudFormation deployment permissions,
  artifact access, secret access on the deployment path, database permissions,
  notifications and costs. Review a change set before an authorized deployment.

The proposed schedule is `cron(0 * * * ? *)` in UTC. Its delivery retry policy is
three retries/3,600 seconds to `DeliveryFailureQueue`; accepted Lambda invocation
failures get two function-error retries/3,600 seconds to `ExecutionFailureQueue`.
Both delivery layers can duplicate work. Reserved concurrency one is a template
setting, not an application lock or a claim about the live function.

The proposed queues/log group are retained on stack deletion. Queue retention is
14 days; logs follow `LogRetentionDays`. No database, artifact bucket, secret,
SNS topic, VPC or public endpoint is created. Those existing resources are outside
the template's lifecycle. There is no deployed monitoring guarantee from these files.

Run `node --test infra/test/*.test.mjs` for offline wiring checks. These do not
validate live AWS state, CloudFormation schema acceptance, log filters or database
connectivity. No template deployment or cloud-side validation is part of the
current workflow.
