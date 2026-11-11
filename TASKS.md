# Pitchfork ingestion — implementation work log

Session: 2026-11-10. Scope: implement the agreed single-source hourly ingestion
specification for AWS Lambda. No deployment, remote database migration, commit,
or provisioning is authorized by this implementation work.

## Task board

| ID | Task | Status |
| --- | --- | --- |
| T01 | Validate source format; record implementation decisions and fixture provenance | Complete |
| T02 | Replace generic article contracts with source, track, and run contracts | Complete |
| T03 | Implement safe bounded HTTP, retries, conditional requests, RSS and metadata extraction | Complete |
| T04 | Implement Drizzle tables/migrations, source seed, atomic upserts, and source locking | Complete (live DB validation blocked) |
| T05 | Implement hourly-run orchestration, durable run records, failure accounting and cache rules | Complete |
| T06 | Implement Lambda entry point, deadline handling, and minimal local invocation | Complete |
| T07 | Add reviewable, undeployed AWS infrastructure and operational alarms/failure paths | Complete (not deployed) |
| T08 | Verify unit/integration tests, migration consistency, bundle, and infrastructure | Complete locally; real DB/cloud validation blocked |
| T09 | Update setup/runbook documentation and final handoff | Complete |

## Initial inspection

- Existing Git repository contains the uncommitted first-pass generic RSS scaffold.
  Preserve the Git history and do not commit or discard unrelated changes.
- Installed workspace dependencies are available. Prefer those dependencies;
  do not install or activate tools without the exact-command approval required
  by the repository's inherited installation policy.
- Node 24 and pnpm are available. No local Postgres executable or SAM CLI found.
  Docker exists; its availability will be checked without pulling images.
- Frontend and API remain placeholders. A standalone CLI product is not needed.
- The existing feed/article model does not implement the agreed track/run model.

## Changes by task

This section is updated as each task progresses, including verification evidence.

### T01 — Source validation

- Read the public RSS endpoint successfully (HTTP 200), and two linked review
  pages: a single artist (Kelela) and multiple artists (Olivia Rodrigo / Chappell Roan).
- Observed RSS fields: quoted track title, review URL, GUID, pubDate, dc:creator
  (review author, not artist), description, and media:thumbnail.
- Observed review JSON-LD: Review.itemReviewed is MusicRecording, whose name
  combines artist credit and track title. Review.headline contains the quoted
  track title. Credited artists also have dedicated header artist links.
- Decision: extract JSON-LD first; use only explicitly scoped header artist links
  when MusicRecording.byArtist is absent. Never collect every artist link in the
  review body (those include unrelated artists). Do not split artist names on
  ampersands, commas, slashes, or the word “and”.
- Fetch review pages as necessary for missing artist metadata. Persist no full
  review prose. Fixture copies will be synthetic structural examples, not full
  copyrighted review pages.
- Decision: database source lease with an expiry and fencing token, checked
  transactionally before each mutation. Do not use session advisory locks with
  Supabase transaction pooling. Bound the Lambda run before lease expiry.

### T02 — Contracts

- Shared typed contracts now describe track metadata, cache validators, source
  leases, ingestion counts, durable run outcomes and sanitized error codes.
- URL identity removes tracking/fragments, preserves meaningful parameters, pins
  publisher hosts/paths/HTTPS, and strips query strings from logged review URLs.

### T03 — Fetching and extraction

- Split bounded HTTP and metadata extraction from RSS discovery. Requests validate
  every redirect, enforce UTF-8/body/time limits, and retry only transient failures
  (maximum three attempts). Long Retry-After values are not shortened.
- RSS parsing rejects entity declarations, malformed/wrong feeds and unsafe
  entries. Critic and artist identities are kept separate.
- JSON-LD plus scoped header extraction handles collaborations without splitting
  names on punctuation. Genres/labels preserve the publisher's displayed group
  string; release dates are never inferred from review publication timestamps.
- Added synthetic fixtures with provenance and parser/HTTP regression tests.

### T04 — Database

- Added ingestion_sources, tracks and ingestion_runs while retaining the original
  feeds/articles schema and migration non-destructively. Legacy tables are unused.
- Generated an additive Drizzle migration and added an idempotent Pitchfork source
  seed. No migration has been applied to any database.
- Upserts preserve IDs/first-seen timestamps, merge absent optional metadata,
  distinguish inserted/updated/unchanged, and refresh last-seen.
- A 360-second database-time lease uses a random fencing token. Every track/run
  mutation checks that token under a source row lock. Expired workers cannot
  overwrite data after a successor acquires the source.
- Next acquisition closes interrupted running records and clears stale validators.
- Discovery/rejections checkpoint durably; each track write increments its run's
  inserted/updated/unchanged counter in the same transaction. Interrupted workers
  therefore retain counts of committed work. Finalization returns persisted counts.
- Each repository operation has a 15-second client bound and terminates the driver
  on timeout/work-signal abort. SQL timeouts are SET LOCAL within each transaction,
  not session/startup assumptions that a transaction pooler might ignore.

### T05 — Run lifecycle

- Discovery, enrichment, per-track commits, aggregate counts, bounded error details,
  final status, source cache state and release are now coordinated explicitly.
- Individual invalid entries/pages do not block valid tracks. Database/feed/run
  deadline failures fail the run; already committed tracks remain stored.
- Partial/failed runs clear validators so the next poll retries unconditionally,
  including when the RSS document itself has not changed. 304 is successful.

### T06 — Lambda/local entry points

- Lambda ignores untrusted event overrides and invokes the same single-source
  service. It closes the database, prints one sanitized structured summary and
  throws on failed/partial results for asynchronous retry handling.
- Work budget is at most 240 seconds, reserving at least 60 seconds of a
  300-second invocation for database finalization and cleanup.
- Removed generic feed-management CLI; local.ts is only a thin invocation/preview
  wrapper. Added ingest, ingest:preview and offline ingest:fixture commands.

### T07 — Infrastructure

- Delegated only infra/ to an independent agent while implementing the application.
  Reviewable JSON CloudFormation and 15 dependency-free wiring/security tests exist.
- Review caught an old partial-failure log marker; the agent is updating it to the
  actual structured handler contract before final acceptance.
- Final review resolved the marker mismatch: the quoted partial_failure term is
  tested against all four statuses with Lambda's text-log prefix. Infrastructure
  has 16 passing tests. Roles, separate encrypted failure queues, retained logs,
  alarms and a disabled hourly UTC schedule are reviewable; nothing is deployed.

### T08 — Verification so far

- 38 application unit tests and 15 initial infrastructure tests passed.
- Offline fixture preview succeeds with title, two distinct artist credits, critic,
  publication date, summary, thumbnail, genre and label.
- Live validation complete: all 30 current feed entries parsed successfully with
  credited artists; zero feed/item extraction errors. No database writes occurred.
- Typecheck, 41 offline application/schema tests, 15 infrastructure tests,
  two real-bundle smoke tests, and migration-generation consistency passed.
- Four real-Postgres integration tests compile but skip without TEST_DATABASE_URL.
  They test IDs/first-seen/optional merge, source isolation, two-client contention,
  expired-token fencing, interrupted-run recovery, cache/run atomicity and uniqueness.
- Requested an independent application correctness/security review while writing
  setup/spec/runbook documentation; findings will be resolved or recorded here.

### Independent review — findings resolved

- P1: database waits could outlast the work signal. Added bounded client operations
  that terminate the driver on expiry/abort, transaction-local SQL timeouts and
  tests proving teardown occurs before rejection (not just a Promise race).
- P2: a URL-less unrelated Review could precede the correct JSON-LD. Explicitly
  matching review URLs now take precedence; an unbound fallback must be unique.
  Regression tests cover the reported wrong-title/wrong-artist reproduction.
- P2: committed track counts could be lost before finalization. Track mutations
  and progress counters now commit together; takeover preserves those counts.
  Real-Postgres tests include simulated interruption after a committed insert.
- Additional hardening: database cleanup now finishes before a success summary is
  logged. A rejected close emits one failed summary instead of misleading success.
- Actual Postgres/pooler execution remains unverified, not represented as passing.

### Final verification and stop

- Final typecheck passed.
- Final offline application/schema/deadline suite: 46 passed.
- Infrastructure structural/security suite: 16 passed.
- Actual bundled Lambda artifact smoke suite: 2 passed.
- Real Postgres suite: four tests compile; skipped without TEST_DATABASE_URL.
- Drizzle generation reported no schema differences; the checked-in migration and
  snapshot are consistent. No migration was executed against a database.
- Earlier read-only live extraction: 30/30 current feed entries succeeded.
- Offline preview passed. Git whitespace checks passed; .env, production env,
  node_modules, builds and ZIP artifacts are ignored.
- No dependency installations/upgrades, service activation, image pulls, secret
  access, database provisioning/migration, AWS resource changes, or commits occurred
  during this implementation session. Initial scaffold/dependencies predated it.
- Both subagents have been stopped. At the user's request, finish the current
  verification/documentation work and stop; no new work is started.

### T09 — Documentation

- README.md now documents the focused source, local commands, Supabase connection
  modes, RLS/role prerequisites, real DB test setup, and the undeployed AWS boundary.
- docs/ingestion-spec.md preserves the agreed spec plus explicit implementation
  decisions: duplicate count semantics, bounded retries, cache recovery and fencing.
- docs/operations.md covers status queries, safe error diagnostics, interrupted
  runs, stale caches, recovery, alerts, rotation, retention and maintenance.

## Decisions, blockers, and follow-up

- Do not access user secrets or change a remote database to obtain test coverage.
- Do not deploy resources while the user is away. Infrastructure will remain a
  reviewable scaffold with explicit deployment prerequisites.
- A live feed format check is required. If external access is blocked, record
  that fact; use clearly labeled synthetic fixtures rather than claim live proof.
- Local Postgres integration execution is blocked: no Postgres binaries and the
  installed Docker client cannot reach a running daemon. No service was started,
  image pulled, or software installed. Build the real integration suite anyway
  and document how to run it against a disposable database later.
- Production enablement still requires a real disposable-Postgres integration run,
  production role/RLS policy setup, AWS template schema/security validation,
  existing secret/artifact/SNS configuration and an authorized deployment.
- CloudFormation invariants were tested locally, not with a full AWS schema/security
  validator. Missing validation tools were not installed, and no live AWS call was
  used to validate/deploy the template. Notification delivery and real Lambda
  execution still need an authorized development deployment.
- Known intentional limits: grouped genre/label strings are not an inferred taxonomy;
  canonical URL changes are not automatically merged with old identities;
  interrupted runs retain committed counters but can leave entries unprocessed;
  historical recovery/freshness monitoring/run
  history pruning are not implemented. These are called out in the spec/runbook.

## Follow-up — handler readability refactor

- Replaced inline timing values with named constants for the default invocation
  timeout, maximum work duration, database-cleanup reserve and minimum work duration.
- Extracted work-signal creation and run/database-cleanup helpers; named the
  dependency interface and consolidated completion-log formatting.
- Kept existing timing, error sanitization, cleanup and single-summary behavior.
- Added tests for local/default timing, the four-minute cap, cleanup reserve,
  shared cancellation signal and the one-second minimum-work boundary.
- Verification: seven handler tests, typecheck and two bundled-handler smoke tests
  passed; Git whitespace check passed. No dependencies installed or AWS changes.

## Follow-up — repository code hygiene

### Completed tasks

- C01: Centralized application timing in apps/ingestion/src/timing.ts and HTTP/DB
  defaults in their owning packages. Named parser/text limits and shared the
  run-error cap between orchestration and storage. Did not expose new environment
  settings or rewrite generated migrations/schema snapshots.
- C02: Separated feed-entry processing from source/run lifecycle and response-body
  reading from redirect/retry handling. Expanded compressed branches/catches,
  removed nested ternaries and replaced the transaction cleanup boolean with a
  named phase option. Added a typed completion-log payload.
- C03: Preserved primary exceptions and failed/partial result codes when source
  release or database close also fails. Secondary codes are sanitized and logged
  separately. Added regressions for simultaneous failures and bounded termination.
- C04: Moved merge/hash tests from shared/test into db/test and removed the
  ingestion test's direct import of DB internals. Its memory fake now implements
  only its public contract instead of executing production DB merge logic.
- C05: Added policy/boundary tests for work/cleanup/lease relationships, template
  timeout consistency, database timeout ordering, validator/text/feed limits and
  cancellation before a queued operation begins.
- C06: Switched test commands to Node's test runner with the existing tsx loader.
  The tsx CLI attempted an IPC socket denied by the local execution restrictions;
  the loader path avoids that unnecessary socket without changing dependencies.
  Schema generation no longer loads .env because it needs no database connection.
- Updated docs/ingestion-spec.md with policy ownership, rationale and cleanup
  semantics. Original application limits, parser identity rules and database
  transaction boundaries are retained.

### Verification

- Initial verification: typecheck passed; 62 offline application/schema/policy
  tests, 16 infrastructure tests, two bundled-handler smoke tests and offline
  fixture preview passed.
- Four Postgres integration tests skipped without TEST_DATABASE_URL. No database
  service was installed/started and no remote migration was attempted.
- Final repeat verification passed: typecheck, 62 offline application/schema/policy
  tests, 16 infrastructure tests and two bundled-handler smoke tests (80 total).
- Drizzle generation reported no schema differences. Migration files/snapshots
  remain unchanged; no database migration was executed.
- Whitespace validation included untracked source/docs as well as Git's diff check.
- No dependency installations, cloud changes, deployments or commits.


## Follow-up — RSS-only handler test mode

- Commented out database imports, setup, ingestion orchestration, and cleanup in
  the Lambda handler, retaining the code for restoration after connectivity tests.
- The active handler fetches the fixed Pitchfork RSS URL with the existing deadline,
  logs the parsed response as JSON, and returns it without database configuration.
- Added handler coverage for fixture parsing/logging, sanitized fetch/parse failures,
  deadline behavior, and an RSS-only bundled Lambda smoke test.
- No dependencies installed, database operations performed, or AWS changes made.
- Verification: typecheck, 58 application tests, 16 infrastructure tests, and three
  built Lambda smoke tests passed (77 tests total). Live network/AWS execution
  was not performed.

## Follow-up — Lambda upload script

- Added `pnpm upload:lambda <function-name> <region> [aws-profile]` for an existing
  standalone test Lambda. Requires installed tools and authenticated CLI access.
- Checks runtime/handler/ZIP configuration; runs typecheck, local tests, build and
  bundle smoke tests; creates a fresh temporary ZIP; updates code with revision
  protection and waits for completion. Leaves configuration/aliases unchanged.
- Added local tests with fake AWS/pnpm commands for successful packaging, target
  selection, preflight rejection, build failures, upload failure and waiter failure.
- No AWS upload, installation, provisioning, or invocation was performed.
- Verification: shell syntax, typecheck, 58 application tests, 16 infrastructure
  tests, nine mocked upload tests, and three bundle smoke tests passed (86 total).

## Authorized Lambda upload — musicRssFeed

- Signed in to account `783161622181` using local profile `music-discovery`.
- Ran `pnpm upload:lambda musicRssFeed us-east-2 music-discovery` with explicit
  user authorization. Typecheck and all 86 local tests passed.
- Uploaded the RSS-only bundle to `$LATEST`; AWS's function-updated-v2 waiter
  completed successfully. Code SHA-256: `hsRsZFWnQjpAn/t/as5sgw3u5vOuNRKsqKffL/BCvX0=`.
- No function configuration, database, schedule, or alias changes were made.
  The function has not been invoked as part of this upload.

## Follow-up — default upload target musicRssFetcher

- `pnpm upload:lambda` now defaults to the full ARN of `musicRssFetcher` in account
  `783161622181`, region `us-east-2`, using local profile `music-discovery`.
- Explicit function/region/profile arguments still override the defaults.
- Updated usage documentation and added a mocked regression test checking the
  target ARN, region, and profile on every AWS command. No AWS changes performed.
- Verification: shell syntax, all 10 mocked upload tests, typecheck, and Git
  whitespace checks passed. No Lambda bundle source changed in this update.

## Follow-up — simplify RSS handler timing

- Removed the database ingestion timing policy from the active RSS handler.
- RSS requests/retries share a 30-second maximum budget; under Lambda this is
  capped at remaining invocation time minus 250 milliseconds for logging/return.
  Local runs use 30 seconds. The one-minute database cleanup reserve is retained
  only with the commented database path; the database orchestration is unchanged.
- Updated deadline boundary tests and bundled parsing regression to exercise a
  three-second Lambda context. Updated setup docs to suggest a 30-second timeout.
- No AWS configuration changes or uploads performed in this update.
- Verification: typecheck, 58 application tests, 16 infrastructure tests, 10 mocked
  upload tests, and three rebuilt Lambda smoke tests passed (87 total).

## Follow-up — AWS Lambda Context type

- Installed `@types/aws-lambda` 8.10.164 as a root development dependency using
  the exact approved pnpm command with lifecycle scripts disabled. Existing
  dependency versions in the lockfile remain unchanged.
- Replaced the custom LambdaContext interface with a type-only import of Context
  from `aws-lambda`, including references in the preserved database handler.
- Handler tests now provide complete Context fixtures checked by TypeScript.
  Optional context for local invocation and RSS timing behavior are unchanged.
- No AWS uploads or configuration changes performed.
- Verification: typecheck, all 87 local tests, rebuilt Lambda bundle smoke tests,
  and Git whitespace checks passed. The type-only import adds no runtime dependency.

## Follow-up — handler retries and attempt logging

- Added up to three handler retries after the initial RSS fetch (four attempts
  maximum), with 1/2/4-second exponential backoff and Retry-After handling.
- Disabled the HTTP layer's own retries on this path to prevent multiplying
  attempts. Permanent failures and invalid feeds are not retried.
- Every request and cancellation-aware backoff shares the RSS deadline; timeout
  exhaustion stops retrying. Non-cancellation backoff failures preserve the
  original fetch error.
- Structured logs identify starts, attempt failures, retry schedules, success
  responses, and one terminal failure, including attempt number and request ID.
  Error logs contain sanitized codes, not raw exception messages or response bodies.
- Added deterministic tests for exhaustion, recovery, permanent failures,
  Retry-After, cancellation during backoff and actual HTTP attempt counts.
- No dependencies installed or AWS code/configuration changes performed.
- Verification: typecheck, 64 application tests, 16 infrastructure tests, 10 mocked
  upload tests, three rebuilt Lambda smoke tests, and whitespace checks passed
  (93 tests total). Live AWS/network execution was not performed.

## Follow-up — named logEvent function

- Extracted the logging closure into a module-level function with explicit logger,
  request ID, event name, and detail arguments. Log payloads remain unchanged.
- Typecheck, 11 handler tests, three rebuilt Lambda smoke tests, and whitespace
  checks passed. No dependencies installed or AWS upload performed.

## Follow-up — explicit abort and retry exhaustion logs

- Added `rss_fetch_aborted` once for deadline exits, including failure before the
  first attempt and cancellation during fetch or backoff.
- Added `rss_fetch_max_attempts_reached` when a transient failure exhausts all four
  attempts (initial request plus three retries), with attempt/maxAttempts/code.
- Both events include requestId and retain the final `rss_fetch_failed` event.
- Typecheck, 12 handler tests, three rebuilt Lambda smoke tests, and whitespace
  checks passed. No AWS upload or configuration changes performed.

## Follow-up — log severity

- Added INFO/WARN/ERROR levels to structured log records and routed them to
  console.log/console.warn/console.error respectively. Starts and successes are
  INFO; attempt failures and retries are WARN; aborts, exhausted attempts and
  terminal failures are ERROR. Request IDs and sanitized error codes are retained.
- Replaced the single injected log function with a logger supporting those three
  methods. Updated existing assertions and tested default console routing for
  success, retry, exhaustion and abort paths. No dependencies or AWS changes.
- Verification: typecheck, 13 handler tests, three rebuilt bundle smoke tests,
  and whitespace checks passed. No upload performed.

## Follow-up — log level constants

- Defined INFO/WARN/ERROR once in a LOG_LEVEL const object and derived LogLevel
  from its values. Log routing and call sites now reference those constants.
- Log payloads and runtime behavior remain unchanged. No dependencies or AWS changes.
- Verification: typecheck, 13 handler tests, three rebuilt bundle smoke tests,
  and whitespace checks passed.

## Cleanup before Supabase integration

- Reviewed the full workspace and retained the PostgreSQL schema, migration
  history, database service, parser and integration tests needed for Supabase.
- Removed empty API/frontend placeholders, unused database-handler timing settings,
  an unused database type re-export, and unnecessary exported/internal helpers.
  Simplified redundant handler error normalization and expanded compressed control
  flow without changing RSS retry, deadline or logging behavior.
- Enabled TypeScript checks for unused locals/parameters and updated timing tests
  to verify the actual work/template/lease relationship.
- Rewrote the README around the current RSS-only handler and upload target.
  Corrected deployment claims, removed obsolete commented-handler instructions,
  and marked database/infrastructure runbooks as the future integration path.
- This commit also includes the previously requested RSS-only Context types,
  bounded retries, explicit abort/exhaustion logs, severity levels, named logging
  function, and upload script defaulting to musicRssFetcher.
- No dependency installation/removal, database setup/migration, Lambda upload or
  AWS resource change was performed during this cleanup. Supabase setup is next.
- Verification: typecheck with unused-code checks, 66 application tests, 16
  infrastructure tests, 10 mocked upload tests, three rebuilt Lambda smoke tests
  (95 total), offline fixture preview, shell syntax and whitespace checks passed.
  Credential-pattern scan found no matches; environment/build files are ignored.
  Real PostgreSQL integration and live AWS/network testing were not performed.
