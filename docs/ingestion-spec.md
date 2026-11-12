# RSS track ingestion specification

## Current scope

The Lambda is managed in the AWS console, including manually configured runtime
environment variables. The initial Supabase schema/source seed has been applied.
The handler calls `ingestSource` to fetch the feed, enrich reviews, log metadata
and persist tracks and run tracking. Successful runs save feed validators; partial
or failed runs clear them. Hosted track-upsert integration remains unverified.

Hourly polling requires a separately configured console trigger. No
CDK/CloudFormation stack manages the existing function.
See [operations](operations.md) and [infrastructure status](../infra/README.md).
The frontend is a listening-room prototype; there is no public API, playback or
historical backfill. Spotify recording matching is a separate Lambda app; see
[the matcher contract](../README.md#track-matcher-lambda).

## Discovery and extraction

The source registry currently supports the Pitchfork adapter only; additional
publisher adapters need their own tested URL and metadata rules. Source registration
uses existing schema fields and requires no migration. See [source selection and
registration](../README.md#selecting-and-registering-sources).

Seeded source key (explicitly supplied in events): `pitchfork_best_new_tracks`. Feed:
`https://pitchfork.com/feed/reviews/best/tracks/rss`.

The parser accepts at most 100 RSS items, validates review URLs/headings, and folds
duplicate normalized URLs before processing (last valid occurrence wins). `found`
is the raw item count; errors and duplicates are reported separately. No date
watermark or pagination is used. Entries disappearing from RSS are never deleted.

RSS `dc:creator` is the critic, not the musician. Each review page is therefore
fetched to resolve artists and validate metadata:

1. Select Review JSON-LD whose `itemReviewed` is MusicRecording and whose declared
   URL, if present, agrees with the final/canonical review URL.
2. Prefer `MusicRecording.byArtist`; otherwise use only scoped
   `SplitScreenContentHeaderArtistLink` anchors. Never split artist names on punctuation
   or collect unrelated links from review prose.
3. Obtain the title from the review headline/RSS title, removing one matching pair
   of song-title quotation marks; fall back to the recording name if needed.
4. Use a validated Pitchfork canonical review URL as track identity.

Required track fields are a canonical source URL, nonempty track title and credited
artists. Optional fields include GUID, review heading/critic/date, summary, image
URL, genres, labels and recording release date. Missing values remain null/empty.
Review publication date is not a release date. Genre/label grouping is preserved
as supplied. No HTML, full review prose, images or audio are stored; parsed metadata
is deliberately logged. [Fixtures](../packages/rss/test/fixtures/README.md) are synthetic.

URLs must use approved HTTPS Pitchfork hosts/paths. The feed URL comes from the
source row, can have its own path under `/feed/` and query parameters, and is not
replaced by a compiled URL. Identity normalizes `www`,
fragments and known tracking parameters while retaining meaningful query values.
URLs, not titles, artists, GUIDs or dates, determine duplicates. No automatic
canonical alias merging is implemented.

## Persistence and lifecycle

### Streaming match schema

Migration `0001_track_streaming_matches.sql` is additive and was applied to the
configured Supabase database with explicit authorization on 2026-11-12. Read-only
verification confirmed its journal hash, all 15 columns, primary/foreign keys,
four validated check constraints, RLS enabled and no access policies. The new table
was empty. No new grants/policies were added. Initial migration history remains
unchanged. Database integration tests still require a disposable database with
both migrations already applied; those tests were not run against Supabase.

Each row belongs to an existing editorial `tracks` row. The composite primary key
`(track_id, provider)` allows one selected recording per service. `provider` is a
lowercase identifier such as `spotify` or `soundcloud`; new services do not require
new columns or a provider enum migration. Provider recording IDs are not globally
unique because separate reviews can recommend the same recording. The foreign key
uses NO ACTION, so deleting a referenced track requires explicit match cleanup.

| Fields                               | Meaning                                                                   |
| ------------------------------------ | ------------------------------------------------------------------------- |
| `match_status`                       | `pending` (default), `matched`, `not_found`, or `ambiguous`               |
| `provider_track_id`, `provider_url`  | Durable provider identifier and public track/attribution URL              |
| `provider_title`, `provider_artists` | Optional provider recording metadata                                      |
| `uploader_name`, `uploader_url`      | Optional uploader credit/profile, distinct from credited artists          |
| `match_method`                       | `review_link`, `search`, or `manual`                                      |
| `matched_at`                         | Time the current match was established                                    |
| `last_attempt_at`, `last_error_code` | Last lookup attempt and optional sanitized failure code                   |
| `created_at`, `updated_at`           | Creation and most recent write times; `updated_at` must be set by writers |

A `matched` row requires nonempty provider ID/URL, method and match timestamp.
All other statuses require recording, uploader, method and match timestamp fields
to be null: unresolved candidates must not appear as confirmed recordings. No row
means the provider has not been scheduled/attempted. Creating a pending row is
optional until a matching workflow exists. SQL checks enforce state consistency;
future provider adapters must validate provider-specific identifiers and HTTPS URLs.

The Spotify matching store retains successful matches on transient failures,
updates attempt/error fields independently and clears an old error on successful
lookup. Matcher writes lock the editorial track and reject changes to its title or
credited artists since lookup began. Ingestion locks the same track and deletes
all provider rows in its upsert transaction when title or artists change; review
metadata changes preserve them. New providers must follow this locking contract.
See [the matcher contract](../README.md#track-matcher-lambda) for search limits,
invocation shape, errors and required permissions.
Keep provider data outside the editorial metadata hash. Store no audio, temporary
stream URLs, credentials, or global `is_playable` flag. Resolve playback availability
for the listener and market when playback is requested; a match is not a guarantee
of streaming access. RLS grants/policies require deliberate setup before a
backend role uses the table; public clients get no access from this migration.

### Ingestion writes

The applied migration creates RLS-enabled `ingestion_sources`, `ingestion_runs` and
`tracks`, plus the Pitchfork source seed. Runtime roles need appropriate grants and
policies; public clients must not gain table access. Preserve applied migrations.

1. Require and validate the event's `sourceKey`, load that registered source
   including its feed URL and metadata, and select its publisher adapter by
   `name`/`category`. The event does not select a URL and there is no default source.
   A disabled source skips without creating a run.
   Missing sources and unsupported adapters fail before a run is created.
2. Begin a run and update the source attempt time/clear validators atomically.
3. Fetch RSS using the previously loaded validators. A 304 skips enrichment and
   writes; otherwise log `feed_parsed` and enrich entries sequentially outside
   database transactions. Log each extracted track before writing it.
4. Checkpoint discovery/rejection issues and upsert valid tracks individually,
   incrementing inserted/updated/unchanged only after each successful write. A
   rejected review does not block later entries. A database failure stops work;
   earlier committed tracks remain stored.
5. Finalize run/source state atomically, retaining at most 100 issues. Successful
   runs save response validators and update `last_success_at`; partial/failed runs
   clear validators for an unconditional retry.
6. The handler closes the database in `finally` on success or failure.

Migration `0002_ingestion_run_counts.sql` adds nullable run counters. Apply it before
deploying the updated ingestion code. Finalization saves the counters atomically
with run/source state, including partial and failed runs; results and completion
logs include the same counts. Historical and unfinalized runs retain NULL counters
because their totals are unknown; no timestamp-based backfill is reliable.

- `found`: raw feed items, before deduplication and validation.
- `seen`: valid tracks extracted from distinct canonical review URLs, including a
  track whose database write subsequently fails.
- `inserted`: new editorial track rows successfully committed.
- `existing`: successfully processed rows already present, equal to `updated + unchanged`.
- `updated` / `unchanged`: existing rows with changed / identical editorial metadata.
  Refreshing `last_seen_at` alone counts as unchanged.
- `rejected`: invalid feed entries or failed review extractions.

For a fully processed run, `seen = inserted + existing`. A database failure can
leave `seen` larger because the failing write was not committed. Duplicates,
rejections and unprocessed entries mean `found` need not equal these totals.
Existing/new classification uses the source and canonical review URL, rather than
artist/title or streaming-provider identity. Concurrent first sightings count only
the transaction that actually inserted the row as new.

`not_modified` means only that the feed returned HTTP 304. Such runs inspect no
tracks and finalize with all counters zero. An HTTP 200 with entirely existing
tracks still has `not_modified = false`.

`succeeded` and `skipped` return normally. `partial_failure` also returns normally
and logs an ERROR-level completion. Terminal `failed` runs throw a sanitized error
after finalization; startup failures may have no run/completion record. A killed
worker can leave a `running` row; later runs do not repair it automatically.

There are no source leases or locks. Concurrent invocations may each open one
connection and update source/run state independently; concurrency settings belong
to the console. The unused template's reserved concurrency is not a live guarantee.

Track upserts enforce uniqueness by `(source_id, source_url)`, stable row IDs and
first-seen time, refreshed last-seen time,
and metadata hashes distinguishing changed/unchanged rows. Missing optional values
do not erase existing metadata. Conditional HTTP uses stored ETag/Last-Modified;
an unsolicited 304 without validators fails feed validation. A 304 does not
revalidate review metadata; clearing source validators forces re-enrichment.

## Limits and cancellation

[Timing and policies](timing-and-policies.md) explains the three policy files,
current values, cleanup-reserve calculation and how to change limits safely.
`handler.ts` owns the RSS phase/retries; `timing.ts` owns the run budget;
`packages/rss/src/http-policy.ts` and `packages/db/src/policy.ts` own I/O limits.
`packages/shared/src/models.ts` separately caps persisted run issues at 100.

Only transient network/timeouts and selected HTTP statuses are retried. Permanent
HTTP failures and invalid feeds fail immediately. The handler's RSS retries can
wait beyond the HTTP helper's 10-second retry-delay limit, within the RSS deadline.
XML entities/DOCTYPEs and unsupported encodings are rejected; every redirect is
validated. Requests and database operations enforce cancellation at their I/O
boundaries. SQL limits are transaction-local for compatibility with pooling.

Database timeout/abort terminates the driver. Finalization has a separate bounded
cleanup allowance; a dead connection may prevent it. Cleanup failures preserve
the primary failure and append safe codes to its `cleanupErrors` property; they
are not part of the normal run summary. A hard Lambda termination can interrupt
cleanup despite the reserved time.

## Logging and verification

Handler JSON logs use `{event, requestId, ...details, level}`. Completion details
are nested under `result`; there are no top-level source/category/status fields.
Feed/track events include full parsed metadata. Error events include safe `code`
and `message`; SQL, credentials and raw driver errors are excluded. See the
[operations event/error tables](operations.md) for interpretation.

Application database transactions, SQL statements and connection shutdown have
paired `database_request`/`database_response` logs with call/parent IDs, request/source
context, timing, counts/outcomes and allowlisted, bounded response data. URL query
strings, validator/GUID values and unknown fields are removed or redacted.
Statement success precedes
commit; the transaction response establishes completion. See
[database log semantics](operations.md#database-request-and-response-logs).

`pnpm test` uses synthetic fixtures and mocked AWS/network calls, including checks
of the undeployed template. `pnpm test:bundle` loads the built CommonJS handler.
`pnpm test:db` separately exercises the database store against a pre-migrated
disposable PostgreSQL database. These checks do not establish live AWS settings,
filter behavior or hosted ingestion success.
