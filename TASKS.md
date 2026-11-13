# Pitchfork ingestion — implementation work log

## 2026-11-13 02:30 UTC — Design per-user tapes from LLM-extracted feeds

- Added the proposed [playlist generation design](docs/playlist-generation-design.md).
  Discovery becomes a shared serverless pipeline: hourly fetch of any registered
  RSS/Atom feed, SQS-driven Claude structured extraction of credited songs
  (including album-review highlights) with verbatim-evidence validation, genre and
  descriptor metadata, and SQS-triggered Spotify matching.
- Tapes become per user: Supabase Auth with Spotify sign-in, KMS-encrypted refresh
  tokens, asynchronous tape generation with deterministic, diversity-aware
  selection, Web Playback SDK playback and optional saving to Spotify.
  Prompt-based tapes are a later phase.
- Broke the design into GitHub issues #16–#43, tracked in #44 with parallel waves.
- Documentation only; no code, dependencies, migrations or deployments changed.
  Open questions are listed in the design and #16.

## 2026-11-12 21:18 UTC — Match Spotify bonus track release labels

- Matched `Born Again` by Star Moles to Spotify's `Born Again - Bonus Track`.
  Title comparison now ignores a trailing `Bonus Track` label after a spaced
  hyphen/en dash/em dash or in spaced parentheses/brackets on either title.
- Preserved original Spotify metadata, complete artist-set comparison, meaningful
  performance/mix suffixes and ambiguity across distinct qualifying recording IDs.
- Added regression coverage for the reported recording, delimiter/case/whitespace
  variants, artist mismatches, version labels, title boundaries and ambiguity.
  Updated the matcher guide and repository guidance.
- Validation: 203 offline tests, root/web typechecks, both Lambda builds, six
  bundle tests, formatting and diff checks passed using existing tool binaries.
  Initial pnpm script attempts unexpectedly tried automatic installation and failed
  on symlinked dependencies; no installation completed. Refined guidance to cover
  symlinked dependencies and direct use of existing binaries. No deployment, live
  Spotify requests or database writes were performed.

## 2026-11-12 20:56 UTC — Log exact Spotify catalog query parameters

- Added `queryParams` to catalog `spotify_request` events, read directly from the
  outgoing URL. The complete decoded `q`, `type`, `market`, `limit` and `offset`
  values are logged without truncation for each page, including failed requests.
  Other parameters, token endpoint queries, credentials and headers stay excluded.
- Updated the operations guide with a request-log example and refined Spotify
  agent guidance to distinguish public search parameters from secret query fields.
- Added regression coverage comparing logs with actual outgoing URLs, including
  query normalization, Unicode, reserved characters, pagination, provider failure
  and exclusion of credentials/unknown parameters/token endpoint queries.
- Validation: all 197 offline tests, typechecks, both Lambda builds, six bundle
  tests, formatting and diff checks passed. No installation, deployment, live
  Spotify requests or database writes were needed.

## 2026-11-12 20:48 UTC — Include Spotify response contents in call logs

- Added `response` and `responseTruncated` to Spotify response events. Catalog
  JSON retains public recording, artist, album and pagination fields; URLs lose
  credentials/query strings/fragments, and unknown fields and arbitrary provider
  error text are excluded. Token responses expose only expiry/type metadata.
- Bounded previews to 10 items per array, 512 characters per string, 8 nested
  levels and 32,000 serialized UTF-8 bytes without modifying matching inputs.
  Error bodies use the existing HTTP size/deadline limits; unreadable/invalid error
  bodies preserve the HTTP failure code, with work cancellation taking precedence.
- Updated operations, limits, repository map and agent guidance. Added regression
  coverage for actual nested response data, token/URL/nested-secret filtering,
  malformed errors, preview limits and HTTP failure preservation.
- Validation: full offline suite (195 tests), typechecks, both Lambda builds and
  six bundle tests passed; the final malformed-error adjustment also passed its
  owning tests and typechecks. Formatting and diff checks passed. No install,
  deployment, database writes or live Spotify calls were needed.

## 2026-11-12 20:20 UTC — Log every Spotify HTTP call

- Added paired `spotify_request`/`spotify_response` JSON events for client-credentials
  requests and every catalog search page, with unique call IDs, invocation request
  IDs, editorial track IDs, operation/offset, duration, HTTP status and safe failure codes.
- Kept credentials, headers, URLs/query text and raw bodies out of logs. Logging
  failures preserve HTTP results; HTTP success records JSON parsing, with later
  response-shape validation still owned by the search workflow.
- Added coverage for pagination, handler correlation, redaction, HTTP/network/body/
  JSON/size failures, cancellation, timeout policy and throwing loggers. Updated
  the README, operations guide and agent guidance.
- Validation: typechecks, full offline suite, both Lambda builds and six bundle
  tests passed. No live Spotify calls, database writes or deployment occurred.
- The first `pnpm format` unexpectedly attempted an automatic install before approval;
  DNS failed and the process was stopped. The subsequently approved frozen-lockfile
  install reused cached packages with zero downloads. Documented pnpm's automatic
  installation behavior so future empty-worktree script runs require approval first.

## 2026-11-12 19:43 UTC — Type the Lambda handler parameters directly

- Applied `IngestionEvent` and `TrackMatcherEvent` directly to their handler event
  parameters so callers receive the expected field hints and compile-time checks.
  Kept runtime parsers to reject malformed invocation JSON before database access.
- Updated the local ingestion caller to validate its CLI source argument before
  constructing the typed payload. Invalid-payload tests explicitly bypass the
  compile-time contract to continue verifying runtime rejection.
- Corrected README guidance. Typechecking, all 184 offline tests, six Lambda
  bundle tests, formatting and `git diff --check` passed. No deployment occurred.

## 2026-11-12 19:40 UTC — Define explicit Lambda invocation contracts

- Added app-owned `IngestionEvent` (`sourceKey`) and `TrackMatcherEvent` (`trackId`)
  interfaces in each app's `models.ts`. Separate typed event parsers validate raw
  invocation input before database access and return only the supported fields.
- Moved existing validation out of handler orchestration, preserving accepted
  source keys/UUIDs and existing error codes. Entry points retain `unknown` until
  parsing succeeds; extra fields remain ignored. Linked contracts and parsers
  from README and updated tests to use the explicit shapes.
- Validation: TypeScript checks, 147 application tests, 37 infrastructure/upload
  tests, six Lambda bundle tests, formatting and `git diff --check` passed.
  Added coverage for malformed payloads, inherited identifiers and ignored fields.
  No dependencies, deployments, migrations or live service calls were needed.

## 2026-11-12 19:24 UTC — Add shared Prettier formatting

- Installed exact root development dependency Prettier 3.10.0 with the approved
  `pnpm add -Dw --save-exact prettier --ignore-scripts` command; updated the lockfile.
- Added `pnpm format` and `pnpm format:check`, shared two-space/double-quote/
  semicolon/trailing-comma settings, and exclusions for generated output, local
  agent configuration, migration history, lockfiles and parser fixtures.
- Applied the initial formatting baseline to supported workspace files and updated
  README and AGENTS.md with the commands and exclusions. No runtime behavior changes.
- Validation: formatting checks, TypeScript checks, 143 application tests, 37
  infrastructure/upload tests, six Lambda bundle tests, production web build and
  `git diff --check` passed. Database integration tests were not run; no database
  behavior changed, and those tests require an authorized disposable database.
- The sandboxed install could not resolve npm DNS; the same approved command
  succeeded with network access. No deployments or remote migrations occurred.

## 2026-11-12 19:10 UTC — Default Lambda upload targets from shared configuration

- Centralized the console-managed target ARNs, region and local AWS profile in
  `scripts/lambda-targets.sh`. Matcher defaults to `trackMatcher`; ingestion
  retains `musicRssFetcher`, both in account 783161622181 / us-east-2.
- Individual and combined upload commands now work without positional arguments;
  explicit target/region/profile overrides and sequential failure behavior remain.
  Updated README, operations, infrastructure status and repository guidance.
- Validation: all 21 mocked upload tests, `pnpm typecheck`, Bash syntax checks and
  `git diff --check` passed. Lambda runtime code is unchanged, so bundle tests
  were not rerun. No AWS calls, uploads or dependency installations occurred.
- Used a local branch in the existing checkout as requested; no worktree or PR.

## 2026-11-12 05:58 UTC — Clarify individual and combined Lambda upload commands

- Added `pnpm upload:ingestion` with an explicit ingestion selector. Changed
  `pnpm upload:lambda` to upload ingestion and matcher in sequence, requiring
  `<ingestion-function> <matcher-function> <region> [aws-profile]`. It validates
  arguments before starting, rejects identical target strings and stops on failure;
  an earlier successful upload is not rolled back. Each app reuses the existing
  checked, revision-protected upload flow. `upload:matcher` remains available.
- Updated README, operations, infrastructure status and AGENTS.md to use the
  explicit ingestion command and document combined-release arguments/behavior.
- Validation: TypeScript checks, mocked upload tests and `git diff --check` passed.
  Covered explicit ingestion selection, combined argument/profile forwarding,
  invalid targets and failure propagation. No AWS upload or installation occurred;
  Lambda source/bundles are unchanged, so bundle tests were not rerun.

## 2026-11-12 05:35 UTC — Add independent Spotify track matcher Lambda

- Added `apps/track-matcher` alongside ingestion, using root TypeScript/test/build
  tooling and existing dependencies. Its `index.handler` accepts one persisted
  track UUID, loads editorial metadata, searches Spotify with client credentials
  and an explicit market, and saves a public recording URL in streaming matches.
- Matching requires normalized exact title and full credited-artist equality.
  Distinct qualifying IDs or incomplete searches are ambiguous; cap search at five
  pages of ten. Provider HTTP has per-request 10-second and 512,000-byte limits,
  no redirects/retries, fixed endpoints and sanitized errors. Work is capped at
  120 seconds with 18.25 seconds reserved for database termination/close and return.
- Added a matching-store contract and bounded/logged PostgreSQL implementation.
  Match writes lock and recheck editorial identity; confirmed/manual matches
  survive repeated lookup and transient provider errors. Ingestion locks the same
  row and invalidates all provider rows on title/artist changes within its upsert
  transaction. Review-only changes preserve matches. Refined AGENTS.md with this
  cross-writer locking requirement.
- Added `build:ingestion`, `build:matcher` and `upload:matcher`; `build:lambda` and
  bundle smoke tests now cover both apps. Existing ingestion upload defaults are
  retained; matcher uploads require explicit function/region and use its own
  bundle. Neither upload command changes console settings.
- Updated README, operations, timing, schema contract, infrastructure status and
  environment examples with invocation, credentials, matching limits, permissions
  and release guidance. Ingestion now needs provider-row DELETE grants/RLS;
  matcher needs track SELECT and streaming-match SELECT/INSERT/UPDATE access.
- Validation: approved `pnpm install --frozen-lockfile --ignore-scripts` reused all
  locked dependencies with zero downloads. `pnpm typecheck`, `pnpm test` (143
  application tests plus 33 script/infrastructure tests), `pnpm test:bundle` (6
  smoke tests) and `git diff --check` passed. Added PostgreSQL integration coverage
  for match persistence, error preservation and identity invalidation but did not
  execute it: no authorized disposable database was supplied. SQL-building unit
  tests cover locking, stale writes, confirmed-match preservation and invalidation.
- No AWS upload/configuration, grants/policies, migration, live Spotify request or
  hosted database write was performed. Live provider/app access remains unverified;
  there is no ingestion-to-matcher trigger, scheduling, backfill or playback yet.

## 2026-11-12 05:15 UTC — Apply streaming match migration to Supabase

- User explicitly authorized migration of the reviewed schema. Preflight used a
  read-only transaction to confirm that runtime/migration connection targets agreed,
  the new table was absent, and the sole journal entry matched the SHA-256 hash of
  `0000_initial.sql`. Applied pending `0001_track_streaming_matches.sql` using the
  existing Drizzle migration configuration, `DATABASE_MIGRATION_URL` from the local
  environment file, and the bundled CA certificate with verified TLS.
- Read-only postflight confirmed exactly two journal entries and the new migration
  hash `8553891565dd106b806a45c071e453adc6ced24992bbca8e4fbd3b07e29b281f`,
  all 15 expected columns, the composite primary key, track foreign key, all four
  validated checks, RLS enabled, zero policies and zero match rows. No audio matching,
  grants, playback service, or Lambda deployment was performed. PR remains unmerged.
- Updated current README/specification to distinguish the applied Supabase state
  from other databases. PostgreSQL catalog verification passed; disposable-database
  integration tests remain unrun. No application code or migration files changed.

## 2026-11-12 05:08 UTC — Add streaming provider match schema

- Added RLS-enabled `track_streaming_matches` with primary key `(track_id,
provider)`, a track foreign key, durable provider references, attribution data,
  matching provenance, and independent lookup attempt/error fields. SQL checks
  enforce supported statuses/methods and require complete references for matches;
  unresolved states cannot retain recording details. Different editorial rows can
  reference the same provider recording.
- Generated additive `0001_track_streaming_matches.sql`, snapshot and journal;
  preserved applied initial history. No migration, grants, policies, matching
  workflow, backfill, or playback service was applied/deployed. Automatic match
  invalidation is a documented future writer responsibility, not active behavior.
- Updated README/specification and repository guidance for provider identity and
  future matching writes. Corrected two existing redaction stack assertions to
  check synthetic secret markers instead of rejecting macOS `/private/tmp` paths.
- Validation: `pnpm typecheck` passed; `pnpm test` passed (122 application tests
  and 30 infrastructure/upload tests); `pnpm test:bundle` passed (4 smoke tests).
  A second `pnpm db:generate --name=track_streaming_matches` reported no drift.
  `pnpm test:db` skipped all 8 tests, including the 2 new constraint/relationship
  integration tests, because no disposable `TEST_DATABASE_URL` was configured.
  PostgreSQL migration execution and constraint enforcement remain unverified.

## Current status

- Lambda `musicRssFetcher` is managed in the AWS console; runtime environment
  variables are set manually. The upload task updates code/CA only.
- The CloudFormation template is undeployed; CDK is not in use.
- The handler logs parsed metadata, persists source/run records and upserts tracks.
  Successful runs save validators; partial/failed runs clear them. These code changes
  require an upload before taking effect in the console-managed Lambda.
- The Supabase initial schema/source seed is applied history. Hosted track-upsert
  integration remains unverified.
- Use [README](README.md), [operations](docs/operations.md) and
  [infrastructure status](infra/README.md) for current instructions.

The entries below are chronological history starting 2026-11-10. Earlier scopes,
authorizations, designs and test counts describe their own task, not current
operating instructions; later entries supersede earlier assumptions.

## Task board

| ID  | Task                                                                                        | Status                                             |
| --- | ------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| T01 | Validate source format; record implementation decisions and fixture provenance              | Complete                                           |
| T02 | Replace generic article contracts with source, track, and run contracts                     | Complete                                           |
| T03 | Implement safe bounded HTTP, retries, conditional requests, RSS and metadata extraction     | Complete                                           |
| T04 | Implement Drizzle tables/migrations, source seed, atomic upserts, and source locking        | Complete (live DB validation blocked)              |
| T05 | Implement hourly-run orchestration, durable run records, failure accounting and cache rules | Complete                                           |
| T06 | Implement Lambda entry point, deadline handling, and minimal local invocation               | Complete                                           |
| T07 | Add reviewable, undeployed AWS infrastructure and operational alarms/failure paths          | Complete (not deployed)                            |
| T08 | Verify unit/integration tests, migration consistency, bundle, and infrastructure            | Complete locally; real DB/cloud validation blocked |
| T09 | Update setup/runbook documentation and final handoff                                        | Complete                                           |

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

## Supabase verified TLS connectivity

- Ignored the local certs directory. The downloaded Supabase Root 2021 CA is a
  public certificate, not a private key; it is valid through April 2031.
- Both DATABASE_URL and DATABASE_MIGRATION_URL initially failed certificate-chain
  validation. Retried with NODE_EXTRA_CA_CERTS pointing at certs/prod-ca-2021.crt
  before Node startup, retaining ssl=verify-full. Both SELECT 1 checks succeeded.
- No credential values were printed, no migration was applied, and no application
  data was written. This verifies local connections, not Lambda connectivity.
- The trust setting was applied only to the check process; future database
  commands/deployments must also supply the certificate/trust configuration.

## Supabase local preparation and Drizzle security update

- Added loopback-only local TLS selection shared by runtime and migration clients,
  plus db:migrate:local/test:db:local commands reading a separate .env.local.
  Tests reject non-loopback no-TLS connections and sanitize invalid URLs.
- User approved installing Supabase CLI and starting Docker Desktop. CLI 3.1.0
  was downloaded and runs, but the add command exited with unapproved esbuild
  build scripts. No additional build approvals or alternative installs were run.
  Local Supabase initialization/container image downloads remain pending.
- With explicit approval, upgraded drizzle-orm from 0.44.7 to exact 0.45.4 using
  --ignore-scripts. Drizzle Kit remains 0.31.11. No migration history was changed.
- Verification: typecheck, 69 application tests, 16 infrastructure tests, 10 mocked
  upload tests and three rebuilt Lambda smoke tests passed (98 total). Generation
  reported no schema changes; no migrations were applied. Real PostgreSQL
  integration tests remain unrun until the local database is ready.
- Audit confirms the high-severity ORM identifier-escaping advisory is resolved.
  One moderate development-only esbuild 0.18.20 advisory remains through Drizzle
  Kit's legacy loader (GHSA-67mh-4wv8-2f99). This upgrade does not resolve that
  separate dependency finding or approve its pending build scripts.
- No hosted database migration or AWS upload/configuration change performed.

## Remove unused legacy schema before first migration

- User confirmed no migrations have ever been applied. Removed the unused
  feeds/articles definitions and replaced the two unapplied migrations and their
  snapshots with one freshly generated 0000_initial baseline.
- The baseline creates ingestion_sources, tracks and ingestion_runs, preserving
  their constraints, indexes, RLS and the manually maintained idempotent Pitchfork
  source seed. Updated schema regression checks and current documentation.
- Verification: typecheck and all 95 tests passed; a second Drizzle generation
  reported no schema changes, and git diff --check passed. Real PostgreSQL
  integration tests were not run because the local database is not ready.
  No migration was applied and no dependencies or AWS resources were changed.

## Follow-up — remove source leases

- Removed lease tokens from sources/runs, source lease expiration, ownership checks,
  acquisition/release methods, lease timing policies and lease-specific errors.
  Source loading now skips only disabled sources; each enabled invocation creates
  an independent run. Unfinished earlier runs are not automatically closed.
- Retained source/URL track uniqueness, per-run source/status validation and atomic
  run/cache finalization. Same-source overlapping executions are allowed; metadata
  and validators follow commit order. There is no application-level ownership gate.
- Clear persisted validators when a run starts, while using the previously loaded
  validators for its request. An interrupted run therefore leaves the next worker
  able to fetch the full feed without lease-based recovery.
- Reconciled persistence with the user's already-removed schema counter columns.
  Counts remain in returned results only. Generated a follow-up migration removing
  lease fields and those counters without rewriting the initial migration.
- Updated regression tests, specification, operations and infrastructure descriptions.
- Verification: typecheck; 67 offline application/schema tests; 26 infrastructure
  and mocked-upload tests, plus three rebuilt Lambda smoke tests passed (96 total).
  Drizzle reports no further schema differences; Git whitespace check passed.
  Four PostgreSQL tests skipped without TEST_DATABASE_URL. No installation,
  database migration, deployment or upload.

## Follow-up — consolidate unapplied migrations

- Squashed the initial schema and lease/counter removal into 0000_initial.sql.
  The initial SQL now creates only the final columns, retaining RLS, foreign keys,
  checks, indexes and the idempotent source seed.
- Replaced the initial snapshot with the final schema snapshot, reset its parent,
  reduced the journal to one entry and removed the second SQL/snapshot files.
- Updated schema tests to compare every table's SQL and snapshot columns with the
  current Drizzle schema. This consolidation assumes the migrations are unapplied;
  no remote database was inspected or modified.
- Verification: typecheck, all four schema tests and Git whitespace checks passed.
  Drizzle generation reported no schema differences. No dependencies installed
  and no database migration executed.

## Follow-up — use Drizzle Kit migration command

- Replaced the custom migration runner with the installed Drizzle Kit `migrate`
  command for hosted and local package scripts. Removed packages/db/src/migrate.ts.
- Added drizzle.migrate.config.ts using DATABASE_MIGRATION_URL, verified TLS and
  a 10-second connection timeout. The local script explicitly enables loopback-only
  no-TLS connections. URL flags cannot override the selected TLS policy, and
  prepared statements remain disabled. Drizzle Kit owns lifecycle/error reporting;
  the old script's custom close timeout and sanitized error wrapper are removed.
- Kept generation configuration independent of credentials. Updated setup and
  policy documentation and included the migration config in typechecking.
- Added offline config tests for actual driver TLS/timeout/prepare options,
  loopback validation and missing/invalid credentials without credential exposure.
- Verification: typecheck, 11 relevant connection/schema/config tests and Git
  whitespace checks passed. Drizzle generation reports no schema differences.
  No dependencies installed, remote migrations applied, deployments or uploads.

## Authorized Supabase schema migration

- With explicit user authorization, ran the built-in Drizzle Kit migration via
  `NODE_EXTRA_CA_CERTS="$PWD/certs/prod-ca-2021.crt" pnpm db:migrate` against the
  hosted database configured by DATABASE_MIGRATION_URL in .env.
- The sandboxed attempt failed; the network-enabled retry applied the single
  consolidated migration successfully with verified TLS.
- Read-only verification confirmed that all three tables match the current schema:
  ingestion_sources has 11 columns, ingestion_runs 7 and tracks 18. RLS is enabled
  on all three, the enabled Pitchfork source seed exists, and migration history
  contains one applied migration. An initial verification import failed locally;
  resolving dependencies from the DB workspace allowed verification to pass.
- No track ingestion, Lambda upload, dependency installation or runtime-role/RLS
  policy provisioning was performed. The full DB integration suite was not run
  against this hosted database.
- 0000_initial.sql is now applied history: preserve it and add new migrations for
  future schema changes rather than editing or consolidating it again.

## Commit preparation — Supabase schema simplification

- Reviewed pending schema, migration tooling, TLS/local configuration and dependency
  changes, including the earlier authorized Supabase CLI and Drizzle ORM update.
- Updated README/spec status to reflect the successful hosted schema migration,
  while retaining the distinction from the unconnected RSS-only Lambda handler.
- Final verification: typecheck, 71 offline application/config/schema tests,
  26 infrastructure/mocked-upload tests and three rebuilt bundle tests passed
  (100 total). Full PostgreSQL ingestion integration tests remain unrun; hosted
  schema/RLS/source-seed checks were performed during migration as recorded above.

- User approved committing the public Supabase root CA certificate. Verified it is
  a single X.509 CA certificate valid through April 2031 with no private-key block.
  Git ignores other files under certs/ and explicitly includes prod-ca-2021.crt.

## Connect RSS handler to database ingestion

- Wired the Lambda/local handler to the existing ingestion service and PostgreSQL
  store using DATABASE_URL. Parsed feed entries are enriched from review pages for
  required artist/title metadata and upserted by source and canonical review URL.
- Retained correlated RSS logs, three transient retries, exponential backoff and
  Retry-After. Feed fetching now uses persisted source validators; only successful
  runs save validators. The handler returns run counts and throws on failed runs.
- Added runtime deadline propagation with a 240-second work cap and a 24.25-second
  reserve derived from database termination/finalization/close limits. Connections
  close on every path; cleanup failures preserve primary failures. Terminal errors
  precede entry issues in failed run summaries so the handler reports the cause.
- Updated operational documentation and handler/bundle regressions for the logged
  feed shape, XML-to-store flow, metadata failures, 304, retries, database failures,
  cancellation, finalization and connection cleanup.
- Verification: typecheck; 72 application/config/schema tests across full and
  affected-suite runs; 26 infrastructure/mocked-upload tests; three rebuilt Lambda
  smoke tests; Git whitespace checks passed. Live PostgreSQL integration tests were
  not run. No dependencies installed, remote migrations applied, Lambda uploaded,
  infrastructure deployed or live tracks ingested.

## Simplify cancellation ownership

- Removed assertWorkCanContinue and repeated cancellation checks from run.ts.
  HTTP and database operations already enforce the shared signal at their own
  boundaries; orchestration now relies on those guarantees. Removed signal
  parameters used only by those redundant checks.
- Added a review-cancellation regression proving cancellation fails/finalizes the
  run without rejecting an entry, writing a track or retaining cache validators.
  The expired-budget test now exercises the HTTP boundary directly.
- Verification: typecheck, 49 relevant application/HTTP/database cancellation
  tests, rebuilt Lambda bundle and three bundle smoke tests passed. No live
  database ingestion, deployment or dependency installation performed.

## Temporarily log tracks instead of upserting

- Added structured track_extracted logs with enriched metadata, request ID in the
  handler, and writeSkipped: true. Commented out the track upsert and write-counter
  increment in processFeedEntries for inspection. Run tracking remains active.
- Temporarily bypass feed validators and clear them on finalization, ensuring
  repeated inspection and later restoration of writes cannot skip unsaved tracks.
- Updated regressions for zero track writes/counts, metadata logging and continued
  processing after a bad review. Updated README and operations guidance.
- Verification: typecheck, 27 ingestion tests, rebuilt Lambda bundle and three
  bundle smoke tests passed; Git whitespace check passed. No deployment, live
  ingestion, database migration or dependency installation performed.

## Log all parsed feeds and tracks

- Added feed_parsed logging for the complete parsed feed, including every accepted
  entry, counts and parsing issues. Retained one track_extracted event per parsed
  track. Handler events include the Lambda request ID; direct service calls and
  local preview/fixture commands also log parsed feeds and tracks.
- Track upserts remain commented out. Run tracking remains active.
- Verification: typecheck, 28 ingestion tests, rebuilt Lambda and three bundle
  smoke tests passed. Local fixture preview emitted feed and track events. Added
  regression coverage for full feed payload and all tracks in a multi-entry feed.
  No deployment, live ingestion or dependency installation performed.

## Include the database CA in Lambda uploads

- The upload task now includes certs/prod-ca-2021.crt at the archive root beside
  index.cjs. A missing, unreadable or empty certificate fails before AWS calls.
- Documented the required Lambda environment setting:
  NODE_EXTRA_CA_CERTS=/var/task/prod-ca-2021.crt. The upload remains code-only and
  does not alter environment variables or other Lambda configuration.
- Packaging tests inspect the real ZIP entries and verify the certificate bytes,
  plus missing/empty-certificate failure paths. All 11 mocked upload tests,
  typecheck, rebuilt Lambda and three bundle smoke tests, shell syntax and Git
  whitespace checks passed. No AWS upload or configuration change performed.

## Make ingestion failures diagnosable

- Added a centralized fixed message for every ingestion error code; Error.message
  now contains CODE: explanation, preserving stable codes and retry metadata.
- Split database configuration, TLS, authentication, permission/RLS, DNS,
  connection, timeout/cancellation and schema failures into specific codes.
  Database operations classify recognized PostgreSQL/Node driver codes through
  bounded Drizzle cause chains; unknown errors remain a safe DATABASE_ERROR.
- Failure/retry/close logs now include descriptive messages. Missing DATABASE_URL
  and invalid connection configuration have distinct actionable messages.
  Raw driver messages, SQL, parameters and original causes are never copied into
  exposed errors. Primary failures remain intact when cleanup fails.
- Added tests for all message defaults, direct/wrapped driver classification,
  credential protection, cyclic/unknown errors and handler propagation before and
  after run creation. Updated timeout/configuration regressions and operations docs.
- Verification: typecheck; full suite (79 application and 27 infrastructure/upload
  tests), followed by 18 targeted tests including the added propagation test;
  rebuilt Lambda and three bundle smoke tests; Git whitespace checks passed.
  No live database tests, deployment, migrations or dependency installation.

## Commit preparation — Lambda feed inspection and diagnostics

- Reviewed the complete changeset: database run tracking and bounded cleanup,
  feed/track inspection logs with track writes still disabled, safe descriptive
  ingestion errors, and CA certificate packaging for Lambda uploads.
- Corrected stale RSS-only documentation and generic error wording that conflicted
  with credential-leak regression checks. No CDK dependency changes remain from
  the canceled setup attempt.
- Final verification: pnpm typecheck, pnpm test (80 application/config/schema tests
  and 27 infrastructure/mocked-upload tests), pnpm test:bundle (rebuilt Lambda plus
  three smoke tests), and Git whitespace checks passed. Live database integration
  was not run; no AWS deployment or database changes performed.

## 2026-11-11 16:57 UTC — Documentation audit: console-managed Lambda

- Reviewed all Markdown documentation against current source/scripts and the
  user-confirmed console workflow. Replaced stale RSS-only, automatic secret
  resolution, deployed scheduling/alarms and active track-write claims.
- Shortened the four main guides from 762 to 413 lines; distinguished the
  undeployed template and its integration gaps from live setup.
- Added a current-status summary to this historical log and deployment ownership
  guidance to AGENTS.md. Fixture provenance remains accurate and unchanged.
- Documentation-only change: checked relative Markdown links, package-script
  references and Git whitespace. Application, bundle and live AWS/database checks
  were not rerun; no code, dependencies, deployments or cloud settings changed.

## 2026-11-11 16:57 UTC — Explain timing and policy ownership

- Added docs/timing-and-policies.md covering run versus I/O limits, every database
  policy setting, HTTP safety/retries, cleanup-reserve arithmetic and console
  timeout ownership. Linked it from README, operations and the specification.
- Added source comments to timing.ts and both policy files. Kept existing limits
  and runtime behavior unchanged; removed the specification's duplicate limits table.
- Verification: typecheck, 12 timing/database/HTTP policy tests, relative-link and
  Git whitespace checks passed. Bundle/live checks were not rerun for comments
  and documentation only; no AWS or database settings changed.
- Pre-commit verification: typecheck, seven timing/database/HTTP policy tests,
  relative Markdown links and Git whitespace checks passed again.

## 2026-11-11 17:28 UTC — Restore track persistence

- Enabled per-track upserts in ingestion and incremented inserted/updated/unchanged
  counts only after successful writes. Invalid reviews remain isolated; database
  write failures stop the run while preserving earlier committed tracks.
- Restored stored feed validators and save response validators only on successful
  runs. Partial/failed runs clear them for a full retry; 304 responses skip reviews
  and track writes. Removed the handler's misleading `writeSkipped` flag; local
  preview/fixture commands remain read-only.
- Updated current guides, runtime track permission requirements and read-only SQL
  checks. Documented that extraction logs precede writes and cannot confirm them.
- Verification: typecheck, 82 offline application tests, 27 infrastructure/mocked
  upload tests, Lambda rebuild and three bundle smoke tests passed. Relative
  Markdown links and Git whitespace checks passed. Used installed tools only.
- Real PostgreSQL integration and hosted ingestion were not run. No dependency
  installation, migration, AWS upload or deployment was performed. The existing
  console-managed Lambda requires a code upload to use the restored writes.

## 2026-11-11 17:32 UTC — Separate storage contracts, client and queries

- Moved `IngestionStore` and related feed/track/source/run contracts into
  `packages/shared/src/ingestion-store.ts`, re-exporting all existing names from
  the package root so consumers need no import changes.
- Extracted connection setup, bounded transactions, error translation and shutdown
  into `packages/db/src/client.ts`. Moved ingestion queries unchanged into
  `createIngestionStore` in `packages/db/src/ingestion-store.ts`; the database
  package root composes them through the existing `connectDatabase` API.
- Updated README ownership links and AGENTS.md guidance to keep future queries
  behind the bounded transaction helper. Preserved the pending track-write changes.
- Verification: typecheck, 82 offline application tests, 27 infrastructure/mocked
  upload tests, Lambda rebuild, three bundle smoke tests, relative Markdown links
  and Git whitespace checks passed. No new dependencies or runtime behavior changes.
- Real database integration was not run; no migration, upload or deployment occurred.

## 2026-11-11 17:37 UTC — Make interface and implementation names explicit

- Replaced the ambiguous shared `ingestion-store.ts` with
  `ingestion-store.interface.ts`, containing only the behavioral storage contract.
  Moved data shapes, the run issue limit and empty-count helper to `models.ts`;
  error definitions/helpers to `errors.ts`; source/URL/identity helpers to
  `pitchfork.ts`. Shared `index.ts` now only exports the public API, with internal
  modules importing owning files directly and no circular barrel imports.
- Renamed the database implementation to `postgres-ingestion-store.ts` and its
  factory to `createPostgresIngestionStore`. `connectDatabase` and package imports
  remain unchanged. Kept the existing `shared` workspace package name to avoid
  requiring dependency reinstallation for this naming refactor.
- Updated README ownership links, the specification's issue-limit location and
  AGENTS.md conventions for interface/implementation filenames.
- Verification: typecheck, 82 application tests, 27 infrastructure/mocked-upload
  tests, Lambda rebuild and three bundle smoke tests passed. Relative Markdown
  links and Git whitespace checks passed. No dependencies were installed.
- Real database integration was not run; no migration, upload or deployment occurred.

## 2026-11-11 17:38 UTC — Document the project structure

- Replaced the README's abbreviated code list and overlapping ownership table
  with a project tree covering application entry points, shared interfaces/models,
  PostgreSQL implementation, RSS/HTTP modules, tests, migrations and support folders.
- Explained explicit interface/implementation filenames, package dependency
  direction, public versus internal imports and handler-to-store wiring.
- Verified documented paths against the working tree, relative README links and
  Git whitespace. Documentation-only change; application tests were not rerun.

## 2026-11-11 17:40 UTC — Lead with project structure

- Moved the README project structure section directly after the introduction,
  ahead of deployment and development guidance. Section content is unchanged.
- Verified section order and Git whitespace; documentation-only change, so
  application tests were not rerun.

## 2026-11-11 17:48 UTC — Recover expired upload sessions

- Reauthenticated the approved `music-discovery` profile with `aws login` using
  the signing-in-to-aws skill; verified STS identity in account `783161622181`.
- The upload script now recognizes the initial configuration check's expired-session
  error, logs in with the same region/profile and retries that check once. Valid
  sessions skip login; unrelated errors, failed login and repeated expiry stop
  before builds/uploads. No authentication retry occurs after an update starts.
- Documented browser sign-in and retry behavior in README and operations. Added
  mocked regression coverage for default/explicit/omitted profiles, failed login,
  repeated expiry and other AWS errors.
- Verification: all 14 mocked-upload tests, Bash syntax, TypeScript typecheck,
  relative documentation links and Git whitespace passed. No dependencies were
  installed and no Lambda code upload, migration or infrastructure change occurred.

## 2026-11-11 18:11 UTC — Add CLAUDE.md entry points

- Added `CLAUDE.md` in the repository and in the home directory. Each imports its
  sibling `AGENTS.md` with `@AGENTS.md`, so the instructions stay in one place.
- Added a note in `AGENTS.md` to keep instructions there rather than in `CLAUDE.md`.
- Verification: documentation-only change; no code, dependencies or infrastructure
  were touched.

## 2026-11-11 21:34 UTC — Select and register ingestion sources

- Added handler `{sourceKey}` selection and local `pnpm ingest --source <key>`;
  older events without the key retain the seeded Pitchfork default. URLs and
  publisher/category metadata are loaded from the database. Completion logs
  include the selected key; malformed keys fail before connection setup.
- Generalized orchestration to `ingestSource` with a publisher adapter contract
  covering validation, fetching and extraction. Kept existing Pitchfork URL and
  metadata rules, with retries wrapping the selected adapter's fetcher. Unsupported
  publishers/categories are rejected before run creation; no generic artist guessing.
- Added `pnpm sources:add --key ... --name ... --category ... --feed-url ...`
  with validation before connecting, insert-only registration, duplicate-key
  errors and bounded database operations/cleanup. Uses existing source table
  fields; no schema migration. Registration creates no schedule or track writes.
- Added source selection/registration regression coverage and an opt-in PostgreSQL
  registration integration test. Updated README structure/commands, specification,
  operations, timing function name and repository adapter guidance.
- Validation: typecheck, 89 application tests, 30 infrastructure/mocked-upload
  tests, rebuilt Lambda and three bundle smoke tests passed. The registration
  command's help, relative Markdown links and Git whitespace were checked. No
  dependency installation, remote registration, migration or deployment occurred.
- Remaining work: implement and validate a second publisher adapter after the user
  supplies its RSS URL (requested during this task). Pitchfork is currently the
  only supported adapter; a registration by itself cannot ingest another publisher.
  Live database integration was not run.

## 2026-11-11 21:39 UTC — Put publisher rules with their adapter

- Removed `shared/src/pitchfork.ts`. Moved Pitchfork constants, URL policy, RSS
  parser/fetcher, HTTP implementation and review extraction under
  `rss/src/publishers/pitchfork/`, with its own adapter implementation. Shared now
  contains publisher-neutral contracts, data models, source validation, error
  messages and generic URL/log sanitization.
- Moved metadata SHA-256 hashing directly into the database merge module; removed
  the ambiguously named shared hash helper. Moved publisher URL tests to RSS and
  extended shared sanitization coverage to other HTTP hosts and rejected schemes.
- Added neutral RSS HTTP/feed data models and an explicit FeedFetcher contract.
  Named public publisher APIs `fetchPitchforkFeed`, `parsePitchforkFeed` and
  `extractPitchforkTrack`. Handler retries wrap the adapter's supplied fetcher
  without an implicit Pitchfork fetch fallback. Updated consumers and README tree.
- Preserved Pitchfork's URL/redirect restrictions and metadata behavior. Generic
  safe logging now strips query/fragment data on any valid HTTP(S) host; it does
  not authorize fetch destinations. Database tests use generic source fixture URLs.
- Updated AGENTS.md ownership guidance. Verification: typecheck, 90 application
  tests, 30 infrastructure/mocked-upload tests, Lambda rebuild, three bundle smoke
  tests, source-command help, relative README links and Git whitespace passed.
- No dependencies installed, remote data changed or deployments performed. Live
  database integration was not run. Second-publisher support remains pending its
  feed URL; this cleanup preserves the preceding source-selection/registration work.

## 2026-11-11 21:46 UTC — Make Postgres authoritative for feed configuration

- Required `sourceKey` in Lambda events and local live ingestion/preview commands;
  removed the implicit Pitchfork selection and all provider feed URL constants
  from runtime code. The existing source row supplies feed URL, publisher,
  category, enabled state and validators before adapter fetching and track upserts.
- Kept publisher host/protocol/path validation with the adapter. Pitchfork feed
  URLs now accept configured paths under `/feed/` and query parameters rather
  than duplicating the seeded feed path in code; the fetched feed must still match
  its Best New Tracks parser. Provider URL examples remain in seeds/tests/docs.
- Added `previewSource` using read-only source lookup and unconditional HTTP fetch;
  live previews now require `--source <key>` and load `.env`. Offline fixture
  previews retain zero database/network access. CLI failures expose safe error codes.
- Added tests proving the four-step flow uses the stored custom feed URL, ignores
  an event-supplied URL and writes extracted tracks. Covered unknown sources,
  required event context, configurable feed URL validation and read-only previews.
- Updated README, operations, specification and upload completion guidance. Existing
  trigger/test payloads must supply a source key; documented the retained undeployed
  template's missing key. No schema migration or remote trigger changes performed.
- Verification: typecheck, 94 application tests, 30 infrastructure/mocked-upload
  tests, Lambda rebuild and four bundle smoke tests passed. Offline fixture CLI,
  relative documentation links and Git whitespace checks passed. Live database
  integration was not run; no dependencies installed, remote writes or deployments.

## 2026-11-11 22:03 UTC — Name source files by responsibility

- Renamed the local registration entry point from `sources.ts` to
  `apps/ingestion/src/add-source.cli.ts`, preserving the `pnpm sources:add` command.
- Renamed shared source validators from `sources.ts` to `source-validation.ts`,
  updating the public barrel export and README tree. Historical work-log paths
  remain as records of their original tasks.
- Added a dedicated AGENTS.md naming section: describe subject and role, use
  action/entity `.cli.ts` entry points, avoid vague filenames for focused behavior,
  and retain the existing interface/implementation and public-import conventions.
- Verification: typecheck, nine source-registration/shared tests, CLI help, Lambda
  rebuild and four bundle smoke tests passed. Relative README links, active path
  references and Git whitespace checked. No dependencies, remote writes or deployment.

## 2026-11-11 22:14 UTC — Add paired database request/response logs

- Added a database call logger with unique call IDs, transaction parent IDs,
  request/source context, elapsed milliseconds, row/affected-row counts, upsert
  outcomes and safe failure codes/messages. SQL text/parameters, row contents and
  credentials are not serialized. Logger exceptions do not change work or cleanup.
- Named and logged every application transaction and SQL statement in source
  lookup/registration, run tracking and track writes, including transaction-local
  timeout setup. Logged forced termination and normal close. Transaction responses
  follow commit/rollback; driver-managed transaction SQL is covered by that pair.
- Propagated Lambda logger/request ID/source key into database setup; registration
  and live preview provide source keys. Raw Drizzle integration-test setup and the
  separate migration CLI remain outside application logging, documented explicitly.
- Added six focused tests for correlated success/failure, redaction, counts/outcomes,
  logger errors, timeout/late results and concurrent IDs. Added an opt-in PostgreSQL
  test for actual SQL/transaction/shutdown coverage and handler/registration context
  assertions. Updated README, operations, specification and query-wrapper guidance.
- Verification: typecheck, 100 application tests, 30 infrastructure/mocked-upload
  tests, Lambda rebuild and four bundle smoke tests passed. Relative documentation
  links and Git whitespace passed. PostgreSQL integration was not run; no dependencies,
  remote writes, migrations or deployments were performed.

## 2026-11-11 22:29 UTC — Include sanitized database response data

- Added a `response` payload to successful database logs, with allowlisted source,
  track and run fields, timestamps, safe issues, returned IDs and write outcomes.
  Kept existing call correlation, durations and count summaries. Void results log null.
- Added a dedicated response sanitizer: omit unknown fields; remove URL credentials,
  queries and fragments; redact HTTP validator/GUID values. Results used by the
  application are not mutated. Sanitizer failures log a placeholder without changing
  the database call outcome or exposing thrown details.
- Bound responses to 10 rows, 10 array values, 512 characters per string and 16,000
  UTF-8 bytes; mark truncation and replace oversized payloads with a small placeholder.
- Extended unit coverage for returned rows, redaction, limits, multibyte payloads
  and unexpected accessors. Updated the opt-in PostgreSQL logging test, README,
  operations, specification and repository allowlist guidance.
- Verification: typecheck, 104 application tests, 30 infrastructure/mocked-upload
  tests, Lambda rebuild and four bundle smoke tests passed. Relative documentation
  links and Git whitespace passed. PostgreSQL integration was not run; no dependency
  installation, remote writes, migrations or uploads were performed.

## 2026-11-11 23:00 UTC — Evaluate Stereogum RSS before implementation

- Read the live main feed and four linked articles, plus a weekly song-list page.
  The 48,828-byte feed snapshot had 40 posts: 33 tagged New Music, with other
  items covering news, a column and an album review. Category tags overlap.
- All sampled descriptions were attribution links; none of the 40 items included
  content:encoded. Media RSS images were present. Four linked pages exposed
  Article JSON-LD, not the Pitchfork Review/MusicRecording structure.
- Documented single-track, EP/lead-single, collaboration, album and roundup cases
  in docs/sources/stereogum.md, with primary-source links. Recommended an initial
  single-track scope and explicit non-track skip outcomes, preserving current DB
  identity until multi-track posts receive a deliberate identity/migration design.
- Added a README evaluation link and repository guidance for mixed post feeds.
  No adapter or database source was added; no dependency installation, migration
  or deployment occurred. Temporary research XML/HTML stayed outside the repo.
- Verification: XML structure, feed classifications, description/content fields,
  linked-page JSON-LD and canonical redirects inspected. Relative Markdown links
  and Git whitespace passed; application tests were not rerun for documentation only.

## 2026-11-11 23:34 UTC — Define worktree and human-review workflow

- Added AGENTS.md instructions for one worktree/branch per agent task, coordinated
  ownership and isolated test resources, with human commands for switching folders
  and inspecting committed, uncommitted and untracked progress.
- Required completed tasks to publish a PR against main for human review. Documented
  fetching conversation, review submissions, paginated inline comments and checks,
  then pushing follow-up fixes on the same branch.
- Defined post-merge ownership/head/cleanliness checks, service/worktree/branch
  cleanup, handling squash/rebase deletion refusals, and preservation of ignored
  files/dependency approvals. Linked the workflow from README.
- Implemented in a dedicated docs/worktree-collaboration worktree so unfinished
  schema migration edits remain in their original checkout. Verified Git/GitHub
  CLI syntax against installed help and primary documentation. Markdown links,
  example paths and Git whitespace checked; application tests not rerun for docs.

## 2026-11-11 23:55 UTC — Condense workflow guidance after PR review

- Addressed PR #2 comment 6810118352: replaced the detailed AGENTS.md workflow
  with repository expectations for task isolation, human PR review, feedback and
  safe post-merge cleanup. Referenced the personal worktree-pr-workflow skill for
  procedures while keeping the repository rules usable without it.
- Updated the README link description to reflect the condensed section. The earlier
  detailed-workflow entry describes the initial PR revision and is superseded here.
- Validation: relative Markdown links, balanced fences and Git whitespace passed.
  No GitHub checks are configured/reported for this branch; application tests were
  not rerun for documentation-only changes.

## 2026-11-11 23:58 UTC — Remove personal skill references after review

- Addressed PR #2 inline comment 4544567324 by removing the named personal skill
  from AGENTS.md and README. Repository workflow expectations remain self-contained;
  the earlier skill-reference entry describes a superseded PR revision.
- Validation: relative Markdown links, section target, balanced code fences and Git
  whitespace passed. Application tests were not rerun for documentation-only edits.

## 2026-11-12 00:22 UTC — Scaffold React + Vite frontend

- Added `apps/web` (`@music-discovery/web`): hand-written Vite entry, React root and
  placeholder `App`, with its own browser/JSX `tsconfig.json`. No `create-vite`.
- Installed with approval: `react`/`react-dom` ^19.3.1; dev `vite` ^8.3.7 (8.3.8 was
  inside the `minimumReleaseAge` window), `@vitejs/plugin-react` ^6.3.0,
  `@types/react`/`@types/react-dom` ^19.3.0.
- Root `tsconfig.json` excludes `apps/web`; `pnpm typecheck` now also runs the web
  typecheck. Added `pnpm web:dev` and `pnpm web:build`.
- Added `esbuild: true` to `allowBuilds`: pnpm 12 failed the first install with
  `ERR_PNPM_IGNORED_BUILDS` for the existing esbuild 0.18.20/0.25.12/0.28.2.
- A filtered `pnpm add` in the fresh worktree left other workspace packages unlinked
  (`@music-discovery/shared` not found); the approved full frozen install fixed it.
  Recorded the rule in `AGENTS.md` and README.
- Validation: `pnpm typecheck` passed; `pnpm test` 104/104 and 30/30 passed;
  `pnpm test:bundle` 4/4 passed; `pnpm web:build` passed (220 kB JS, 69 kB gzip);
  Vite dev server served the page and transformed `App.tsx`, then was stopped.

## 2026-11-12 00:53 UTC — Implement Floor Session cassette UI (frontend only)

- Implemented the "C5 · Anime" Floor Session design in `apps/web/src/floor-session/`
  for both day and night themes, using the mockups' values as per-theme CSS custom
  properties. No backend integration: tapes come from `sample-mixtapes.ts`.
- Working interactions: play/pause, stop, next/previous (LCD and J-card highlight),
  OPEN eject, loading a tape by drag-and-drop or click, and the lamp theme switch.
- Decisions the mockup left open: the 1440x900 artboard scales to fit its container;
  playback is visual only (no audio) and starts stopped on track 1; the volume slider
  has no effect; an empty player hides the J-card and disables transport keys; tape
  colours follow the weekday, with cassette shell shades derived by `color-mix`.
- Player state is a pure reducer (`mixtape-session.ts`) with tests in `apps/web/test`,
  now part of `pnpm test`. The web `tsconfig.json` includes `test` and Node types.
- Validation: `pnpm typecheck` passed; `pnpm test` 116/116 and 30/30 passed;
  `pnpm web:build` passed (237 kB JS, 20 kB CSS). A headless Chrome run against the
  dev server (not committed) passed checks for the initial state, transport, drag
  onto the player, drop on the floor, click-to-load, eject, lamp theme switch,
  dark-preference start and scaling to 960x700, with no page errors; day and night
  screenshots matched the mockups. `pnpm test:bundle` was not rerun: the Lambda
  bundle is unaffected.

## 2026-11-12 01:12 UTC — Let tapes rest on the floor (PR #4 follow-up)

- Reported: a tape put down on the mat could not be picked up and moved. A tape
  dropped outside the player previously snapped back to the box.
- Tapes now have three places: player, box, or floor. A dropped tape stays where it
  lands (kept fully on the artboard), can be dragged again from its grip point,
  dropped on the box to put it away, or dropped on/clicked to load it. Its box slot
  reads "ON THE FLOOR". The player itself is still fixed.
- `mixtape-session.ts` gained `floorTapes` with `placeTapeOnFloor`/`returnTapeToBox`;
  `use-tape-drag.ts` reports the drop target and also recovers if the browser takes
  the pointer mid-drag.
- Validation: `pnpm typecheck` passed; `pnpm test` 120/120 and 30/30 passed;
  `pnpm web:build` passed. The headless Chrome run passed with new checks: drop on
  the mat, move twice, a second floor tape clamped at the edge, return to box, load
  from the mat by drag and by click; no page errors.

## 2026-11-12 01:20 UTC — Darken the headphones (PR #4 follow-up)

- Changed the headphone cups from the mockups' pink to dark violet in both themes
  (`--headphone-cup` in `floor-session.css`), by request. This departs from the
  "C5 · Anime" mockups. Checked with day and night screenshots; `pnpm web:build` passed.
- Follow-up: lightened the night-theme cups (`#5a5488` over `#453f6c`) so they stand
  out from the dark floor; rechecked with a night screenshot and `pnpm web:build`.

## 2026-11-12 01:19 UTC — Rename the frontend feature to listening-room

- Renamed `apps/web/src/floor-session/` to `apps/web/src/listening-room/`,
  `FloorSession.tsx`/`FloorSession` to `ListeningRoom.tsx`/`ListeningRoom`, and
  the stylesheet to `listening-room.css`. Updated application/test imports and
  current README documentation; older task entries retain their historical names.
- Validation using installed dependencies: root TypeScript check passed; all 16
  web tests passed; Vite production build passed. Web TypeScript check failed
  with the existing TS2345 nullability error at `FloorItem.tsx:74` (file unchanged
  by this rename). The standard web build includes that check and remains blocked.
  Lambda checks were skipped because this change only renames frontend files.

## 2026-11-12 01:20 UTC — Fix draggable item stage nullability

- Changed the pointer-move handler in `FloorItem.tsx` to a local arrow function
  created after the stage null guard, allowing TypeScript to retain the non-null
  stage type inside the callback. Drag behavior and listener cleanup are unchanged.
- Validation using installed dependencies: root and web TypeScript checks passed,
  all 16 web tests passed, and the complete web build sequence (TypeScript followed
  by Vite) passed. This resolves the blocker recorded in the rename entry above.
- Reviewed README and repository instructions; no further documentation changes
  were needed for this type-narrowing fix. Lambda checks were skipped as unaffected.

## 2026-11-12 21:27 UTC — Simplify README for readers and developers

- Replaced the file inventory and operational runbooks with an app overview,
  current prototype status, developer setup and essential commands.
- Retained matcher configuration/contract details in the operations guide and
  redirected affected documentation links. Recorded the README's scope in AGENTS.md.
- Validation: checked Markdown formatting, local documentation links/anchors and
  commands against package.json. Application tests, typechecking and Lambda builds
  skipped because only documentation changed.

## 2026-11-13 02:56 UTC — Document local source CLI setup

- Added a once-per-terminal CA certificate export to README backend setup and
  explained which database commands require it.
- Added source registration, preview and ingestion examples, including unique-key
  and supported-adapter requirements. Retained operational details in the existing
  operations guide.
- Validation: checked Markdown formatting, referenced files/anchors and commands
  against package.json and the CLI parser. Application tests, typechecking and
  Lambda builds skipped because only documentation changed.

## 2026-11-13 20:04 UTC — Pivot to a personal, local, end-to-end app

- Pivot: Spotify's user quota rules make a public product infeasible, so Tape
  Journal stays a personal project that runs locally and is not hosted. Removed
  the per-user playlist generation design (commit 48d2a0a) and its README link.
- Added `pnpm match`: matches every unattempted or `pending` track through the
  existing matcher handler (`listTrackIdsToMatch` on the matching store).
- Added `apps/api` (`pnpm api:dev`): a loopback-only Node HTTP server with
  `GET /api/tapes` (7 most recent UTC review weeks of matched tracks) and
  `GET /api/spotify-config`, backed by a new `postgres-tape-store.ts`.
- Frontend: tapes come from the API (sample tapes removed); tapes are weekly, with
  week labels and rotating colours; J-card tracks link to their reviews. Browser
  Spotify PKCE sign-in (`spotify-auth.ts`) and the Web Playback SDK
  (`spotify-player.ts`, `use-spotify-player.ts`) drive the cassette controls; the
  reducer follows Spotify state via `playbackChanged`. Vite serves on
  127.0.0.1:5173 and proxies `/api`. No new dependencies.
- Live run against the development database: ingestion found the feed's 30 items
  (all unchanged); matching attempted 27 tracks with 8 matched, 6 not found and 13
  ambiguous, leaving 10 playable tracks; the API returned 7 one-track weekly tapes.
- Validation: backend and web typechecks, 204 offline tests and 37 script tests
  pass, the Vite production build succeeds, and the dev server proxies the API.
  Browser sign-in and audio playback were not exercised (they need an interactive
  Spotify login and the redirect URI registered in the Spotify app).
- Follow-up: the first manual run showed "Spotify couldn't play that" with no
  cause. Playback failures now include Spotify's status, reason and message, and a
  `404` play response transfers playback to the browser device, retrying the
  transfer up to 5 times with growing waits (~15 s), then retries the start.
- Follow-up: the retries still got 404 in Chrome. The room no longer remounts when
  tapes load (a `tapesLoaded` reducer action instead), so only one SDK player is
  created per page; the start shows "Starting the tape…" and fails visibly if
  playback does not begin within 10 s; a final 404 logs Spotify's device list
  (new `user-read-playback-state` scope, so stored tokens without it ask for
  consent again). Playback then worked in Chrome without adding the account to
  User Management. Most likely cause: the remount created a second SDK player
  (the sign-in was also refreshed at the same time, so that is not fully ruled out).

## 2026-11-13 20:22 UTC — Describe the app's sunset and current state in the README

- Rewrote the README overview: what the app does, why it is sunset as a public
  product (Spotify Development Mode admits only hand-added accounts; extended
  quota is limited to established organizations), and its current state (works
  end to end locally; one source; 10 of 30 tracks playable; Premium and desktop
  browser required; not hosted).
- Removed `docs/sources/stereogum.md`, the Stereogum feed evaluation; no adapter
  was built and no other document links to it.
- Validation: Prettier check; figures taken from the live development-database run
  recorded above. Documentation only; no tests or builds run.
