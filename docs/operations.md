# Ingestion operations

The local `musicRssFetcher` handler now performs database ingestion. Deploy with
`pnpm upload:lambda` after configuring `DATABASE_URL`, trusted database certificates,
and a suitable function timeout (300 seconds recommended). No deployment or live
track ingestion has been performed as part of this change.

Track upserts are currently commented out. Inspect `track_extracted` logs with
`writeSkipped: true`; these include enriched metadata and the Lambda request ID.
Run tracking still writes to the database. Feed caching is bypassed and validators
are cleared so repeated inspection does not skip tracks. Write counts remain zero.

## Ingestion checks

- Test with `{}` and inspect the returned run summary and `ingestion_completed` log.
- `rss_fetch_succeeded` records the parsed feed. Each entry is then enriched from
  its review page and logged; required artist metadata is not present in RSS.
- Inspect rejected counts and track_extracted events. Write counts remain zero
  while upserts are disabled; a bad review does not block later entries.
- RSS fetches retain three transient retries, exponential backoff and Retry-After.
  The RSS phase is capped at 30 seconds within the overall work deadline.
- Work stops 24.25 seconds before the Lambda deadline (or after 240 seconds), leaving
  time for operation termination, run finalization, connection close and return.
- `ingestion_failed` and `database_close_failed` contain sanitized error codes and
  descriptive messages.
  Failed runs throw after finalization and connection cleanup.

## Before first real run

- Read README.md and TASKS.md for setup, verification status and unresolved blockers.
- Review/apply migrations only to the intended development database first.
- Verify the seeded ingestion_sources row with key pitchfork_best_new_tracks.
- Use separate migration and runtime credentials. Provision a dedicated runtime
  role and table-specific RLS policies/privileges before production; public
  Supabase anonymous/authenticated clients must not gain access.
- Run disposable-database integration tests, then a deliberately authorized real
  ingestion run. Validate duplicate-safe reruns and failure handling.
- Before AWS deployment, confirm selected Region us-east-2, supported services,
  quotas and billing/spend status. Inspect the infrastructure and notification
  prerequisites in infra/README.md. Keep the schedule disabled during validation.

## Useful read-only queries

Run in a trusted private SQL client:

```sql
SELECT key, enabled, last_attempt_at, last_success_at
FROM ingestion_sources;

SELECT started_at, finished_at, status, not_modified, errors
FROM ingestion_runs
ORDER BY started_at DESC
LIMIT 24;

SELECT track_title, artists, source_url, review_published_at, first_seen_at
FROM tracks
ORDER BY review_published_at DESC NULLS LAST
LIMIT 30;
```

A successful hourly poll can discover zero new tracks. Check last_success_at,
not the newest review's date, to assess poll freshness. A 304 updates source
success time but does not pretend the individual tracks were observed again.

## Interpreting outcomes

| Outcome | Meaning / response |
| --- | --- |
| succeeded | All current valid entries processed, empty feed, or HTTP 304. |
| partial_failure | Some entries/pages were rejected; valid tracks committed. Inspect issue codes and safe source URLs. Cache validators are cleared. |
| failed | Feed/database/network/deadline prevented completion. Existing commits remain. Cache validators clear when finalization succeeds. |
| skipped | Source disabled. No run row is created. |
| running for too long | Worker may have been killed or finalization failed. Inspect manually; later runs leave it unchanged. |

The service bounds work before Lambda's hard timeout when configured accordingly.
Track writes commit individually; counts exist only in the returned result.
There is no application-level source lock. Overlapping executions can overwrite
track metadata and cache state in commit order. The future template limits its
function concurrency to one; other invocation paths must be considered separately.

## Failure codes

- HTTP_ERROR: publisher rejected a request or returned an error. Do not bypass
  access controls; honor Retry-After. Repeated 403/429 requires operator review.
- NETWORK_ERROR / REQUEST_TIMEOUT: DNS/network/response stalled; bounded retries
  apply, followed by later scheduled recovery.
- INVALID_FEED / INVALID_ENTRY: feed format changed or an item lacks a valid
  review URL/heading. Compare against the documented fixture shape.
- MISSING_METADATA / INVALID_METADATA: no reliable artist/track metadata, unrelated
  JSON-LD, or changed header structure. Update fixtures/parser deliberately.
- UNSAFE_URL: unexpected host, credentials, protocol, port, canonical or path.
  Review source changes; do not loosen the allowlist indiscriminately.
- RESPONSE_TOO_LARGE / UNSUPPORTED_ENCODING: bounds/encoding mismatch; inspect
  privately before raising limits.
- DATABASE_CONFIG_MISSING / DATABASE_CONFIG_INVALID: configure a valid runtime
  DATABASE_URL; local no-TLS mode is restricted to loopback hosts.
- DATABASE_TLS_ERROR: check certificate trust, hostname and expiry, the bundled CA,
  and NODE_EXTRA_CA_CERTS=/var/task/prod-ca-2021.crt.
- DATABASE_AUTH_ERROR: check the database username/password and pooler credentials.
- DATABASE_PERMISSION_ERROR: check runtime role grants and RLS policies.
- DATABASE_DNS_ERROR / DATABASE_CONNECTION_ERROR: check hostname resolution, port,
  database availability and outbound network connectivity.
- DATABASE_TIMEOUT: a connection, query or lock timed out, or the server canceled
  a query. Inspect database load and network access.
- DATABASE_SCHEMA_ERROR / SOURCE_NOT_FOUND: check the target database, migrations
  and Pitchfork source seed.
- DATABASE_ERROR: unrecognized database failure. This fallback never copies raw
  driver messages, SQL or parameters. Known PostgreSQL/Node codes are classified
  through bounded Drizzle cause chains; unknown failures need private diagnostics.

- RUN_DEADLINE: remaining run budget exhausted. Committed tracks remain. Inspect
  slow requests/DB behavior before increasing work budget or Lambda timeout.

Every IngestionError has a stable code and a fixed descriptive message in the form
`CODE: explanation`. Failure logs include both `code` and `message`. Database
classifications follow [PostgreSQL SQLSTATE codes](https://www.postgresql.org/docs/current/errcodes-appendix.html)
and [Node system errors](https://nodejs.org/api/errors.html#common-system-errors).

## Recovery

Run the same source again only after the transient issue is resolved; upserts are
idempotent. Partial failures clear validators so unchanged RSS entries are retried.
A successful follow-up can contain only unchanged updates.

Feed retention limits recovery. Entries removed before successful ingestion may
require a separately designed, manually reviewed historical import. Do not mark
a partial run successful merely to suppress alerts.

After changing parsing logic, clear the source's HTTP validators in a reviewed
database change so a 304 does not prevent reprocessing the current feed. Clearing
the validators is not a migration and is not done automatically here.

Run creation clears persisted validators before work, so an interrupted run is
retried with a full feed fetch. Failed finalization can leave a running row; later
runs do not close it automatically. Do not reset first-seen timestamps during recovery.

## Alerts, logs and queues

The Lambda prints a structured ingestion_completed summary and throws sanitized
errors on failed/partial runs. Infrastructure alarms cover execution failures,
throttles, Scheduler delivery failures, failed asynchronous destination delivery,
and failure-queue depth. Supply a working existing SNS topic/subscriptions to
receive notifications; otherwise alarms exist without notifications.

No hourly database freshness monitor has been deployed. Inspect last_success_at
or add a separately approved freshness check; a disabled schedule, persistent busy
source, or no invocations can produce missing metrics rather than execution errors.

Scheduler's delivery queue means Lambda could not accept an event. Lambda's
execution queue contains failed accepted invocations. They are separate retry
layers; retries and manual replays may duplicate work. Inspect and replay deliberately,
never attach an uncontrolled automatic replay loop.

Run records contain metadata/error codes only, not feed/review bodies or credentials.
Lambda logs and dead-letter destination records remain operator-only. CloudWatch
has configured retention; database run history has no automatic pruning in this
version. Choose and review a retention policy before long-term production use.

## Secrets and maintenance

DATABASE_URL is resolved from the existing Secrets Manager JSON key at deployment.
Rotation alone does not refresh Lambda's environment: follow infra/README.md's
reviewed configuration-update procedure and verify new connectivity before
retiring credentials. Restrict Lambda configuration readers as well as secret access.

Disable scheduling for maintenance, then account for already accepted retries.
Disabling Scheduler does not cancel queued Lambda events. Review retained logs
and queues before cleanup; retained resources can continue to incur costs.

