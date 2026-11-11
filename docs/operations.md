# Ingestion operations

The current `musicRssFetcher` target is a regular RSS-only Lambda in `us-east-2`.
The local handler includes retries and structured logs; use `pnpm upload:lambda`
to deploy it. Supabase is not yet connected and the hourly infrastructure template
has not been deployed.

## Current RSS checks

- Test with `{}` and inspect the returned parsed response.
- Check CloudWatch logs for `rss_fetch_succeeded` or `rss_fetch_failed`, grouped by
  requestId. INFO identifies starts/successes, WARN identifies retry activity, and
  ERROR identifies aborts, exhausted attempts, and terminal failures.
- `rss_fetch_aborted` indicates deadline exhaustion; `rss_fetch_max_attempts_reached`
  means the initial request and all three retries failed. Both precede the final
  failure event. Inspect the sanitized code and configured timeout.
- Individual invalid entries appear in the successful response's feed.errors;
  that is distinct from an invocation-level failure.
- A 30-second function timeout is recommended. The handler leaves 250 milliseconds
  for logging/return. The upload script does not change the function timeout.

## Future database pipeline

The remaining sections describe the planned database worker. They become applicable
when Supabase is configured and the handler is wired to the ingestion service.

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
SELECT key, enabled, last_attempt_at, last_success_at, lease_expires_at
FROM ingestion_sources;

SELECT started_at, finished_at, status, found, inserted, updated, unchanged,
       rejected, not_modified, errors
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
| skipped | Source disabled or leased by another invocation. No run row is created. Persistent skips need lease/freshness investigation. |
| running for too long | Worker may have been killed or finalization failed. On next successful lease acquisition, the row becomes failed/INTERRUPTED_RUN. |

The service stops before Lambda's hard timeout when possible. Track writes and
their committed-operation counters are transactional checkpoints. Abrupt termination
can still prevent final status/error records or leave entries unprocessed. The lease is 360 seconds;
never blindly clear it while an invocation may still be running. A stale token is
fenced from future writes once a successor takes over.

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
- DATABASE_ERROR: connectivity, role, schema or write problem. Error details are
  intentionally not logged; consult private database diagnostics.
- LEASE_LOST: old worker cannot commit after expiry/takeover. Check unusually long
  execution, clock/deadline configuration and duplicate invocations.
- RUN_DEADLINE: remaining run budget exhausted. Committed tracks remain. Inspect
  slow requests/DB behavior before increasing Lambda timeout/lease bounds.
- INTERRUPTED_RUN: next acquisition detected an unfinished previous invocation.

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

Failed database finalization can leave a running row and old validators. The next
successful acquisition closes that row and clears validators before fetching.
Do not rewrite old run history or reset first-seen timestamps during recovery.

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

