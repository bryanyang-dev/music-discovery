# Lambda operations

## Configuration and releases

Manage `musicRssFetcher` in `us-east-2` through the Lambda console. Environment
variables are set there manually: `DATABASE_URL` for the private PostgreSQL runtime
connection and `NODE_EXTRA_CA_CERTS=/var/task/prod-ca-2021.crt` for the bundled CA.
Use Node.js 24, ZIP packaging and handler `index.handler`; a 300-second timeout is
recommended. Confirm network access to Pitchfork and the database, database
credentials/grants/RLS, and CloudWatch logging permissions on the execution role.

Use `pnpm upload:ingestion` for tested ingestion code/CA uploads. It leaves console configuration
unchanged. `pnpm build:lambda` builds locally only. Neither command uploads `.env`
or copies local environment values into Lambda. After uploading, test `{"sourceKey":"pitchfork_best_new_tracks"}` in the
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

## Track matcher operations

The console-created `trackMatcher` is a separate deployment. Use
`pnpm upload:matcher` for an authorized release, with Node.js 24 and
`index.handler` configured in that function. Shared target ARNs, region and profile
are maintained in [`scripts/lambda-targets.sh`](../scripts/lambda-targets.sh).
Explicit `<function-name> <region> [aws-profile]` arguments override these defaults.
Both individual upload commands run the full offline checks and bundle smoke tests, then package
only the selected app. See [matcher configuration and payload](../README.md#track-matcher-lambda)
for Spotify variables, timeout, database permissions and example invocation.
The matcher is invoked directly with one `trackId`; ingestion does not invoke it.

`track_matching_completed` logs `requestId`, `trackId` and the persisted status;
`track_matching_failed` logs only `requestId` and a safe code. Database calls use
the same paired logs described below. Every Spotify HTTP call, including token
acquisition and each catalog search page, emits `spotify_request` and
`spotify_response` JSON events. Pair them by `callId`; `requestId` and `trackId`
correlate them with the invocation and editorial row. `operation` is `token` or
`search`; search events include the zero-based result `offset`.
Search request events also include `queryParams` with the exact decoded `q`, `type`,
`market`, `limit` and `offset` from the outgoing URL. Values are strings and are
not truncated; `q` shows the final query after editorial text normalization. Each
page logs its actual offset. Other query parameters and token endpoint query
strings are excluded. For example:

```json
{
  "event": "spotify_request",
  "operation": "search",
  "queryParams": {
    "q": "track:\"A Song\" artist:\"An Artist\"",
    "type": "track",
    "market": "US",
    "limit": "10",
    "offset": "0"
  }
}
```

Responses include
`status` (`succeeded` or `failed`), `durationMs`, and `httpStatus` (null when no HTTP
response arrived); failures include a safe `code` at ERROR level. Success means
the bounded HTTP body was read and parsed as JSON; later schema validation or
matching can still fail the invocation. Logger failures do not alter HTTP results.
`spotify_response.response` contains the actual parsed catalog JSON filtered to
public fields, including tracks, artists, albums, recording IDs and pagination.
URL credentials are rejected and query strings/fragments are stripped. Unknown
fields and arbitrary provider error text are excluded; JSON error responses retain
public status fields. Token responses expose only `token_type: "Bearer"` and
numeric `expires_in`, never the access token. Request bodies and headers are excluded.

Response previews retain at most 10 items per array, 512 characters per string and
8 nested levels; `responseTruncated` marks size/depth truncation. Previews over
32,000 serialized UTF-8 bytes are replaced by an omission marker. The original
response used for matching is unchanged. Missing, unreadable, oversized or non-JSON
bodies log `response: null`; unsuccessful HTTP status codes keep their existing
safe failure code even when their body cannot be read or parsed.
`SPOTIFY_AUTH_ERROR` includes denied application access (401/403); verify Spotify
app access and credentials. On
`SPOTIFY_RATE_LIMITED`, retry later. Other network, HTTP and malformed-response
failures use `SPOTIFY_REQUEST_FAILED`; oversized bodies use `RESPONSE_TOO_LARGE`.
There are no in-process provider retries. Invocation retries/destinations remain
console settings; unresolved results return normally rather than triggering retries.

`TRACK_NOT_FOUND` means no matching editorial row exists. `TRACK_CHANGED` means
metadata changed during lookup; retry against current metadata. Provider failures
preserve prior matches and record safe attempt diagnostics when time permits.
A database deadline can prevent diagnostics from being saved. Persistence or close
failure fails the invocation. An ingestion role without DELETE/RLS access on
`track_streaming_matches` will fail identity-changing upserts; provision that access
before releasing the updated ingestion bundle. Live Spotify/hosted matcher writes
have not been verified by offline tests.

`pnpm upload:lambda` runs the ingestion upload and then the matcher upload using
the shared defaults. Override both with
`pnpm upload:lambda <ingestion-function> <matcher-function> <region> [aws-profile]`.
Explicit targets must be distinct. The command stops on the first failure.
An earlier successful upload is not rolled back.
Each individual upload runs its release checks before updating that function.

## Source selection and registration

Invoke with `{ "sourceKey": "pitchfork_best_new_tracks" }` to select the registered
feed. Missing/invalid keys fail before connecting; no default source or feed URL
is compiled into the handler. Select a source from
local ingestion with `pnpm ingest --source <key>`. Completion logs include the key.
Feed URLs and publisher/category metadata come from the database. URLs supplied
in invocation payloads are ignored. Update existing trigger payloads to include
`sourceKey` before using the new handler. Unknown keys fail;
disabled sources skip; unsupported publisher/category pairs fail before run creation.

Use `pnpm sources:add --help` for the local registration command. After authorizing
the database write, supply `--key`, `--name`, `--category` and `--feed-url`; see the
[README example](../README.md#selecting-and-registering-sources). It uses `DATABASE_URL`,
requires source INSERT privileges/RLS, rejects duplicate keys without updating old
rows, and creates no trigger. It validates adapter compatibility before connecting.
Only the Pitchfork Best New Tracks parser is currently supported; its stored
URL must use HTTPS on an approved Pitchfork host under `/feed/`, and its content
must match that parser. A different publisher needs an implemented adapter before
registration. No schema migration is needed.

Live previews use `pnpm ingest:preview --source <key>` to read the source from
Postgres and fetch/enrich without writing any source/run/track data. They load
`.env` and require source SELECT grants/RLS. `pnpm ingest:fixture` remains entirely
offline. Review-page failures terminate a preview; ingestion isolates bad reviews.

## Track persistence

The handler writes source/run records and upserts each valid track in a separate
transaction. Each review page supplies artist metadata absent from RSS. Invalid
entries/reviews do not block later entries; a database write failure stops the run.
Earlier committed tracks remain stored if later work fails. Successful runs save
feed validators; a 304 skips review fetches and track writes. Partial/failed runs
clear validators so the next poll retries the full current feed.

| Log event                                                                 | Contents                                                                                    |
| ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `rss_fetch_started`, `rss_fetch_succeeded`                                | Attempt; success also includes the parsed fetch response                                    |
| `feed_parsed`                                                             | Entire parsed feed: entries, counts and parsing issues                                      |
| `track_extracted`                                                         | One enriched track before its database write; this event alone does not confirm persistence |
| `rss_fetch_attempt_failed`, `rss_fetch_retry_scheduled`                   | Safe failure details or retry delay in milliseconds                                         |
| `rss_fetch_aborted`, `rss_fetch_max_attempts_reached`, `rss_fetch_failed` | Deadline, exhausted retries or terminal fetch failure                                       |
| `ingestion_completed`                                                     | Nested `result` with status, run ID/counts/issues, or disabled-source skip reason           |
| `ingestion_failed`, `database_close_failed`                               | Safe error code and descriptive message                                                     |
| `database_request`, `database_response`                                   | Paired database transaction, SQL statement and shutdown metadata; see below                 |

Handler logs include `requestId` and `level`; only RSS attempt events have an
attempt number. Local previews log feeds/tracks without a Lambda request ID and
retain `writeSkipped: true`; `pnpm ingest:preview` and `pnpm ingest:fixture` never write.
`ingestion_completed.result.status` can be:

| Status            | Meaning                                                                                         |
| ----------------- | ----------------------------------------------------------------------------------------------- |
| `succeeded`       | Valid entries were persisted, the feed was empty, or HTTP returned 304                          |
| `partial_failure` | Some entries/reviews were rejected; later valid tracks were persisted; handler returns normally |
| `failed`          | Feed, database or deadline failure; handler throws after cleanup                                |
| `skipped`         | Source disabled; no run row created                                                             |

Inserted/updated/unchanged counts reflect completed database upserts. `found`
counts raw RSS items; `rejected` counts invalid entries/reviews. Counts are returned/logged, not stored
as database columns. A startup failure can produce `ingestion_failed` without a
completion event. A worker killed before finalization can leave a `running` row.

## Database request and response logs

Database logging is enabled by default for application storage APIs: source lookup,
registration, run tracking, track upserts and matcher reads/writes, including live
preview source reads.
Each transaction, application SQL statement (including timeout setup), normal close
and forced termination emits `database_request` followed by `database_response`.
Driver-managed BEGIN/COMMIT/ROLLBACK are covered by the transaction pair. Direct
Drizzle access used in integration-test setup and the separate migration CLI do
not use this application logger.

Requests identify `operation`, `scope` (`transaction`, `query` or `connection`) and
a unique `callId`. Query/termination logs include `parentCallId` linking them to
their transaction. Lambda propagates `requestId` and `sourceKey`; local commands
include the source key with `requestId: null`.

Responses repeat the identifiers and add `status` and `durationMs`. Array results
include `rowCount` and, when supplied by the driver, `affectedRowCount`. Track
transactions report `outcome: inserted | updated | unchanged`; other responses
report `hasResult`. Successful calls also include `response`: sanitized returned
rows, a source/run object, run ID or write outcome; void results become `null`.
Source responses expose configuration such as key, publisher/category, enabled
state and a sanitized feed URL. Track/run responses include recognized metadata,
timestamps, counts and safe issue details. Unknown fields are omitted; URL query
strings/fragments and credentials are removed, and ETag/Last-Modified/GUID values
are redacted. The actual result used by ingestion is unchanged.

Response data is limited to 10 rows, 10 values per array, 512 characters per string
and 16,000 UTF-8 bytes. `responseTruncated` marks length/size truncation; oversized
responses use a placeholder. If sanitization fails, the call still succeeds and
logs `[response unavailable]`. These limits belong to
`packages/db/src/database-response-sanitization.ts`.

Failures use ERROR level with a classified `code` and fixed safe `message`;
successful calls use INFO level. SQL text, parameters, connection strings and raw
driver errors remain excluded from these events.

A successful statement does not prove its transaction committed; use the parent
transaction's successful response to confirm that boundary. A timeout can be
followed by a late statement response, while the transaction remains failed.
Hard termination can leave a request without a response. Logger exceptions are
ignored so logging cannot change database outcomes or prevent cleanup.

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

| Error code                                            | Check                                                                                |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `DATABASE_CONFIG_MISSING` / `DATABASE_CONFIG_INVALID` | Runtime `DATABASE_URL`; PostgreSQL URL syntax; URL-encoded password                  |
| `DATABASE_TLS_ERROR`                                  | Bundled CA, `NODE_EXTRA_CA_CERTS`, certificate expiry and hostname                   |
| `DATABASE_AUTH_ERROR`                                 | Database/pooler username and password                                                |
| `DATABASE_PERMISSION_ERROR`                           | Runtime role grants and RLS policies                                                 |
| `DATABASE_DNS_ERROR` / `DATABASE_CONNECTION_ERROR`    | Hostname, port, network access and database availability                             |
| `DATABASE_TIMEOUT`                                    | Connection/query/lock timeout or server-side query cancellation                      |
| `DATABASE_SCHEMA_ERROR` / `SOURCE_NOT_FOUND`          | Target database, applied migrations and requested source registration                |
| `INVALID_SOURCE` / `UNSUPPORTED_SOURCE`               | Event source key, registration arguments, publisher/category and compatible feed URL |
| `SOURCE_ALREADY_EXISTS`                               | Choose a different key; registration never overwrites existing sources               |
| `DATABASE_ERROR`                                      | Unclassified database failure; inspect database diagnostics privately                |
| `HTTP_ERROR` / `NETWORK_ERROR` / `REQUEST_TIMEOUT`    | Publisher response, network access, Retry-After and deadlines                        |
| `INVALID_FEED` / `INVALID_ENTRY`                      | Feed format, required fields and allowed URLs                                        |
| `MISSING_METADATA` / `INVALID_METADATA`               | Review JSON-LD and scoped artist-header layout                                       |
| `UNSAFE_URL`                                          | Host, protocol, port, credentials and path validation                                |
| `RESPONSE_TOO_LARGE` / `UNSUPPORTED_ENCODING`         | Response size and encoding                                                           |
| `RUN_DEADLINE`                                        | Work budget and slow HTTP/database operations                                        |

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
