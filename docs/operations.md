# Ingestion operations

## Configuration and releases

Manage `musicRssFetcher` in `us-east-2` through the Lambda console. Environment
variables are set there manually: `DATABASE_URL` for the private PostgreSQL runtime
connection and `NODE_EXTRA_CA_CERTS=/var/task/prod-ca-2021.crt` for the bundled CA.
Use Node.js 24, ZIP packaging and handler `index.handler`; a 300-second timeout is
recommended. Confirm network access to Pitchfork and the database, database
credentials/grants/RLS, and CloudWatch logging permissions on the execution role.

Use `pnpm upload:lambda` for tested code/CA uploads. It leaves console configuration
unchanged. `pnpm build:lambda` builds locally only. Neither command uploads `.env`
or copies local environment values into Lambda. After uploading, test `{}` in the
console and inspect that request's logs. See [README](../README.md#deployment).

If the initial function check reports an expired AWS session, the upload script
runs `aws login` using the selected region/profile (default `music-discovery`).
Complete the browser sign-in; the script then retries the check once and continues
the normal release checks. A failed login, repeated expiry or unrelated AWS error
stops the upload. It does not attempt authentication recovery after an update has
started. Use AWS CLI 2.32.0 or newer for `aws login`.

CloudFormation/CDK do not manage this function. The
[retained template](../infra/README.md) does not establish live schedules, queues,
alarms, retention or concurrency. Check those settings in the console as needed.

## Track persistence

The handler writes source/run records and upserts each valid track in a separate
transaction. Each review page supplies artist metadata absent from RSS. Invalid
entries/reviews do not block later entries; a database write failure stops the run.
Earlier committed tracks remain stored if later work fails. Successful runs save
feed validators; a 304 skips review fetches and track writes. Partial/failed runs
clear validators so the next poll retries the full current feed.

| Log event | Contents |
| --- | --- |
| `rss_fetch_started`, `rss_fetch_succeeded` | Attempt; success also includes the parsed fetch response |
| `feed_parsed` | Entire parsed feed: entries, counts and parsing issues |
| `track_extracted` | One enriched track before its database write; this event alone does not confirm persistence |
| `rss_fetch_attempt_failed`, `rss_fetch_retry_scheduled` | Safe failure details or retry delay in milliseconds |
| `rss_fetch_aborted`, `rss_fetch_max_attempts_reached`, `rss_fetch_failed` | Deadline, exhausted retries or terminal fetch failure |
| `ingestion_completed` | Nested `result` with status, run ID/counts/issues, or disabled-source skip reason |
| `ingestion_failed`, `database_close_failed` | Safe error code and descriptive message |

Handler logs include `requestId` and `level`; only RSS attempt events have an
attempt number. Local previews log feeds/tracks without a Lambda request ID and
retain `writeSkipped: true`; `pnpm ingest:preview` and `pnpm ingest:fixture` never write.
`ingestion_completed.result.status` can be:

| Status | Meaning |
| --- | --- |
| `succeeded` | Valid entries were persisted, the feed was empty, or HTTP returned 304 |
| `partial_failure` | Some entries/reviews were rejected; later valid tracks were persisted; handler returns normally |
| `failed` | Feed, database or deadline failure; handler throws after cleanup |
| `skipped` | Source disabled; no run row created |

Inserted/updated/unchanged counts reflect completed database upserts. `found`
counts raw RSS items; `rejected` counts invalid entries/reviews. Counts are returned/logged, not stored
as database columns. A startup failure can produce `ingestion_failed` without a
completion event. A worker killed before finalization can leave a `running` row.

## Limits and connection cleanup

See [timing and policies](timing-and-policies.md) for which file owns each limit,
the cleanup-reserve calculation and tuning guidance.

- Overall work: at most 240 seconds, capped at Lambda remaining time minus a
  24.25-second cleanup reserve. Too little remaining time fails before connecting.
- RSS fetch: 30-second cap inside that work budget, initial attempt plus three
  retries, 1/2/4-second backoff, honoring longer Retry-After values until deadline.
- Review HTTP: up to three attempts, 12 seconds per attempt; retry waits above
  10 seconds stop that review request rather than retrying earlier than requested.
- Database: one client connection per invocation, 5-second connect timeout,
  8-second SQL/2-second lock limits and 15-second operation deadline.
- The handler awaits connection close in `finally`, with a 3-second close timeout.
  Abort/operation timeout terminates the driver. A hard Lambda kill can interrupt
  cleanup; closure failures emit `database_close_failed`.

Concurrent invocations can each open one connection; there is no source lock.
Supabase's backend/pooler/service connections need not disappear when a Lambda
client disconnects. Inspect connection ownership before treating a dashboard count
as a leak. Our client sets `application_name=music-discovery-ingestion`.

## Read-only database checks

Run in Supabase SQL Editor or a trusted SQL client:

```sql
SELECT key, enabled, last_attempt_at, last_success_at FROM ingestion_sources;

SELECT started_at, finished_at, status, errors
FROM ingestion_runs ORDER BY started_at DESC LIMIT 24;

SELECT source_id, source_url, track_title, artists, first_seen_at, last_seen_at
FROM tracks ORDER BY last_seen_at DESC LIMIT 24;

SELECT application_name, usename, state, count(*)
FROM pg_stat_activity WHERE backend_type = 'client backend'
GROUP BY application_name, usename, state ORDER BY count(*) DESC;
```

`last_success_at` records a successful run, including an empty feed or 304. Tracks
are unique by source/canonical URL; repeated content is unchanged, new metadata
updates the row, and missing optional values preserve existing metadata. Tracks
disappearing from RSS are not deleted. No automatic pruning or recovery of
unfinished run rows is implemented.

## Troubleshooting and maintenance

| Error code | Check |
| --- | --- |
| `DATABASE_CONFIG_MISSING` / `DATABASE_CONFIG_INVALID` | Runtime `DATABASE_URL`; PostgreSQL URL syntax; URL-encoded password |
| `DATABASE_TLS_ERROR` | Bundled CA, `NODE_EXTRA_CA_CERTS`, certificate expiry and hostname |
| `DATABASE_AUTH_ERROR` | Database/pooler username and password |
| `DATABASE_PERMISSION_ERROR` | Runtime role grants and RLS policies |
| `DATABASE_DNS_ERROR` / `DATABASE_CONNECTION_ERROR` | Hostname, port, network access and database availability |
| `DATABASE_TIMEOUT` | Connection/query/lock timeout or server-side query cancellation |
| `DATABASE_SCHEMA_ERROR` / `SOURCE_NOT_FOUND` | Target database, applied migrations and Pitchfork source seed |
| `DATABASE_ERROR` | Unclassified database failure; inspect database diagnostics privately |
| `HTTP_ERROR` / `NETWORK_ERROR` / `REQUEST_TIMEOUT` | Publisher response, network access, Retry-After and deadlines |
| `INVALID_FEED` / `INVALID_ENTRY` | Feed format, required fields and allowed URLs |
| `MISSING_METADATA` / `INVALID_METADATA` | Review JSON-LD and scoped artist-header layout |
| `UNSAFE_URL` | Host, protocol, port, credentials and path validation |
| `RESPONSE_TOO_LARGE` / `UNSUPPORTED_ENCODING` | Response size and encoding |
| `RUN_DEADLINE` | Work budget and slow HTTP/database operations |

Every `IngestionError` exposes `CODE: explanation`. Recognized driver codes are
classified through bounded Drizzle causes; raw driver messages, SQL, parameters
and credentials are not copied into exposed errors. Full feed/track metadata is
logged deliberately, so restrict access to CloudWatch and set retention in the
console; the repository does not configure retention for the current function.

After credential rotation, update `DATABASE_URL` in the console and test before
retiring old credentials. Secrets Manager rotation does not update this manually
configured value. Database migrations require separate authorization and use
`DATABASE_MIGRATION_URL`; preserve applied migration history.

Retry a failed run after fixing its cause; partial/failed runs clear validators
automatically. To force re-enrichment after a successful cached run, an operator
can clear that source's `etag` and `last_modified` through an authorized database
change. Verify runtime track grants/RLS and stored rows after uploading this code;
hosted track ingestion remains unverified. Scheduling is maintained in the console.
