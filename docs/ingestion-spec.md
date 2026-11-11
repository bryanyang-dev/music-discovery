# Pitchfork Best New Tracks — implementation specification

Status: the RSS-only Lambda handler is implemented; the initial Supabase schema
and source seed have been migrated. Connecting the handler is next.
`run.ts` and `packages/db` implement the database pipeline below, but the current
handler does not invoke them. Hosted schema verification passed; full database
ingestion integration remains unverified.
This file records the planned ingestion behavior, including persistent run records;
it does not require AWS Lambda durable executions.

## Goal and exclusions

Poll the dedicated Pitchfork Best New Tracks RSS once per hour, extract track
identity/available metadata, and persist recommendations in Postgres. No frontend,
API, user accounts, other sources, historical backfill, recording matching,
streaming-service lookup, playback, or full-review/media storage.

A tracks row is a publisher recommendation, not a globally resolved recording.

## Discovery and metadata

Source key: pitchfork_best_new_tracks. Source URL:
https://pitchfork.com/feed/reviews/best/tracks/rss

The first run imports every entry currently returned. No date watermark, pagination
or inferred archive is used. Entries disappearing from the feed are never deleted.

Live inspection established that RSS does not contain credited artists:
dc:creator is the critic. Each discovered entry therefore requires its linked
review page to resolve credits and check metadata. Only already-present feed
metadata is reused; an existing database row is not used to conceal a broken
current parser.

Extraction order:
1. Find a Review JSON-LD object whose itemReviewed is MusicRecording and whose
   declared URL, if present, agrees with the page/canonical URL.
2. Prefer MusicRecording.byArtist when explicitly supplied.
3. Otherwise use only the scoped SplitScreenContentHeaderArtistLink anchors.
   Never collect unrelated artist links from review prose or split names on
   punctuation. Header-layout changes fail the entry rather than guess.
4. Obtain the track title from the review headline/RSS title, removing one matching
   pair of enclosing song-title quotation marks. Original spelling/punctuation
   inside the title remains unchanged.
5. Accept a validated Pitchfork canonical review URL as authoritative identity.

Required: source/category, canonical source URL, nonempty track title, nonempty
array of credited artists.

Optional: source GUID, RSS heading, critic, review publication timestamp, feed
summary, image URL, explicitly supplied genre/label labels and recording release
date. Unknown values remain null/empty. Date publication of the review is never
used as release date. Genre/label strings preserve the publisher's grouping
(e.g. Pop/R&B or Label A / Label B), not an inferred taxonomy.

Full HTML, review prose, images, and audio are not persisted. Synthetic fixtures
are documented in packages/rss/test/fixtures/README.md.

## Storage

- ingestion_sources: one seeded source, feed URL/category/enabled status, last
  attempt/success and ETag/Last-Modified.
- tracks: normalized metadata, source foreign key, metadata hash and first/last
  seen/update timestamps. Unique by (source_id, source_url); newest-review index.
- ingestion_runs: source/run identifiers, start/end, status,
  not-modified flag, and at most 100 sanitized issue codes/URLs.
- A single initial migration creates these three tables and seeds the source,
  without source leases or persisted run counters.
  Unused legacy feeds/articles were removed before any migrations were applied.

Only trusted server-side database roles may access the RLS-enabled tables.

## Identity and updates

URLs must be HTTPS on pitchfork.com/www.pitchfork.com with approved path types.
Normalize the www host, fragments and known tracking parameters; retain meaningful
query parameters. Do not deduplicate by title, artist, GUID or publication date.

A unique constraint and atomic upsert prevent duplicate track rows on retries. Preserve row ID and first_seen_at. Refresh last_seen_at for fetched
entries. Compare merged metadata hashes to distinguish inserted/updated/unchanged;
updated_at changes only with supplied content changes. Missing optional metadata
never erases known values. Deliberate deletions of optional fields cannot be inferred
from absence and need a future explicit rule.

Changed URLs are new records unless an explicit safe canonical URL unifies them.
A publisher canonical-URL change can leave an older row behind; automatic alias
merging is deliberately not guessed.

## Run lifecycle and concurrency

1. Load the source by key. Disabled sources skip without creating a run.
2. Create a running record, record the source attempt time and clear its persisted
   HTTP validators in one transaction. This run uses the validators already loaded;
   clearing them ensures an interrupted run is retried with a full feed fetch.
3. Fetch/parse the feed outside transactions and enrich entries sequentially.
4. Commit each valid track separately, checking that its run belongs to the source
   and is still running. No network fetch is enclosed in a database transaction.
5. Finalize the run and source cache state atomically.

There are no source leases or ownership tokens. Runs for different sources are
independent, and overlapping runs for the same source are allowed. The intended
operation is one hourly worker per source; the future template limits its function
concurrency to one. Other invokers are not serialized by the application. Under an
overlap, the last committed track/cache update wins, and per-run counts can be
approximate. Track uniqueness remains enforced by (source_id, source_url).

A killed worker can leave a running record. Later runs do not automatically mark
it failed because it may still be active. Inspect unfinished runs manually.

## Failures and HTTP cache rules

- Successful or empty valid feed: succeeded.
- Some malformed entries or failed enrichment: partial_failure; valid entries commit.
- Feed/network/database/deadline failure: failed; previous commits remain.
- HTTP 304: succeeded, not_modified=true, no page fetches or last-seen updates.
- Retry transient network/timeouts, HTTP 408/429 and selected 5xx only; maximum
  three attempts, exponential backoff, Retry-After respected. Delays above 10 seconds
  defer recovery to a later invocation instead of retrying sooner than requested.
- Failed/partial runs clear validators, forcing the next hourly poll to retry the
  unchanged feed. Only fully successful processing may save validators.
- Rejected entries retry while still present in the feed. A long outage or entry
  removal can cause missed data; historical recovery is out of scope.

Counts: found is the raw RSS entry count. Inserted/updated/unchanged count unique
normalized entries processed against storage; rejected counts invalid entries or
failed enrichment. Duplicate feed occurrences are folded before processing, so
found may exceed the sum of those counters. A failed/deadline run may have
unprocessed entries; the counts are not a claim that those were rejected.

Discovery/rejection error checkpoints are durable. Counts exist only in the run
result, not as database columns; a killed worker loses its in-memory counts.
An ambiguous database acknowledgement can also make result counts approximate.

## Bounds and security

- Feed: 2 MB decompressed UTF-8; review: 3 MB; at most 100 RSS entries.
- Request timeout: 12 seconds per attempt, including response body and redirects.
- Redirects: at most three; validate every target before requesting.
- XML entity/DOCTYPE declarations and non-UTF-8 responses are rejected.
- Current RSS-only handler: at most 30 seconds across requests/retries, capped at
  Lambda remaining time minus 250 milliseconds for logging/return. It does not use
  the database work budget. The handler owns up to three
  retries after the initial attempt, with 1/2/4-second exponential delays,
  respecting longer Retry-After values and the shared deadline. Nested HTTP
  retries are disabled for this path. Only transient HTTP/network/timeout errors
  marked retryable by the HTTP layer qualify; invalid feeds and permanent errors
  fail immediately. Structured logs carry the request ID, attempt number, safe
  error code, retry delay, and final outcome; successful logs include the response.
- Database ingestion service: a 240-second default work budget.
  The future infrastructure template allows a 300-second invocation,
  leaving cleanup time before timeout. Runtime Lambda deadline
  propagation must be wired when the database handler is enabled.
- Database connection: one per invocation, verified TLS, no prepared statements,
  5-second connection timeout, transaction-local 8-second statement/2-second lock
  limits, and a 15-second client-side operation bound. Aborting work or exceeding
  the client bound terminates the driver rather than leaving an active abandoned
  query behind a raced promise. Finalization has its own bounded cleanup
  allowance; an unusable connection may leave the run unfinished.
- Secrets only in private environment/secret configuration, never in logs/events.
- Logs store bounded error codes and approved URL paths without query strings.
- URL host/path checks restrict this to the fixed publisher; this is not a general
  user-supplied URL endpoint and does not implement arbitrary-host DNS defenses.
- Never bypass publisher access restrictions. Treat all displayed content as
  untrusted; any future frontend must escape text and sanitize HTML.

## Lambda and monitoring

Use an on-demand Lambda event function, not an HTTP server, invoked hourly by
EventBridge Scheduler in UTC. Return success on completed/skipped runs; throw a
sanitized code on failed/partial runs for Lambda asynchronous retry handling.
Log one structured ingestion_completed summary per invocation.

Reviewable infrastructure includes separate Scheduler-delivery and Lambda-execution
failure destinations and CloudWatch alarms. Schedule enablement, secret/artifact
creation, notification subscriptions, real schema validation and deployment remain
explicit operational steps, not automatic actions.

Unit/fixture tests run offline. Real Postgres tests cover upserts, independent runs,
source/run validation and atomic run/cache finalization against a pre-migrated
disposable database. Local build tests load the actual RSS-only bundled handler. Infrastructure
tests check structural/security invariants, not cloud-side schema/deployment success.

## Policy ownership and rationale

Operational values are named at their owning boundary, not collected in a
miscellaneous global settings file:

| Owner | Policy | Reason |
| --- | --- | --- |
| apps/ingestion/src/timing.ts | Database work duration | Bounds database ingestion work. Tests ensure it leaves cleanup time within the undeployed template timeout. |
| packages/rss/src/http-policy.ts | Request, redirect, retry, validator and body limits | Bound public-network work and publisher traffic. Three attempts and a 10-second retry-delay ceiling defer long outages to later hourly runs rather than spin. Feed/review bodies retain their 2/3 MB bounds. |
| packages/db/src/policy.ts | Pool, connection, SQL, operation and close limits | Lock timeout precedes statement timeout, which precedes the client deadline. Transaction-local settings are parameterized and do not depend on session state surviving a pooler. |
| packages/shared/src/index.ts | MAX_RUN_ERROR_COUNT | The 100-issue persistence contract is shared by orchestration and storage so truncation rules cannot drift. |
| RSS parsing/text modules | Feed-entry, structured-node and text-character limits | Keep parsing bounds next to their algorithms. Equal numeric values with different meanings remain independent policies. |
| drizzle.migrate.config.ts | Migration URL, TLS and 10-second connection timeout | Drizzle Kit runs migrations with a direct/session connection. Local no-TLS requires an explicit loopback-only flag; CLI manages connection lifecycle. |

These are conservative application defaults, not claims about publisher or cloud
service limits. This cleanup retains the existing ingestion limits and adds no
environment variables.

Cleanup failures preserve the original sanitized failure code. Secondary failures
appear in the completion summary's cleanupErrors array, without raw error messages.
The database deadline's termination step is also bounded by the named close budget,
so a stalled termination callback cannot turn a timeout into an indefinite wait.

