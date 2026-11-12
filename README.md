# Tape Journal

<img width="1469" height="834" alt="ListeningRoomDark" src="https://github.com/user-attachments/assets/bd8dd343-2890-41ea-aa4a-1598e4ba3086" />

Every day, a new cassette tape is created with a selection of songs sourced from curated music blogs and music publications.

## Project structure

This pnpm workspace separates ingestion, track matching, the web frontend, storage
contract, PostgreSQL implementation and publisher HTTP/parsing code. Key files:

```text
apps/ingestion/
  src/
    handler.ts                        Entry point for ingestion lambda
    run.ts                            Feed enrichment and track persistence workflow
    local.ts                          Explicit-source CLI and offline fixture preview
    preview.ts                        Read-only preview of a database-configured source
    add-source.cli.ts                 Entry point for the local source registration command
    source-registration.ts            Registration argument validation and lifecycle
    timing.ts                         Overall work and cleanup budgets
  test/                               Handler, workflow, timing and bundle tests
apps/track-matcher/                    Independent Lambda app, built/tested with root tooling
  src/
    handler.ts                        Track-ID invocation and connection lifecycle
    run.ts                            Metadata lookup, Spotify search and match persistence
    timing.ts                         Matcher work and cleanup budgets
    spotify/search.ts                 Client credentials, catalog search and exact matching
    spotify/http.ts                   Bounded Spotify HTTP and sanitized failures
  test/                               Handler, Spotify and bundle tests
apps/web/
  index.html                          Vite HTML entry
  vite.config.ts                      Vite and React plugin configuration
  tsconfig.json                       Browser/JSX TypeScript settings (excluded from root config)
  src/
    main.tsx                          React root mounting
    App.tsx                           Theme state (day/night) and today's date
    listening-room/
      ListeningRoom.tsx               Scene composition, artboard scaling and session wiring
      listening-room.css              Design values; per-theme custom properties
      models.ts                       Track and mixtape data shapes
      mixtape-session.ts              Player and tape-location reducer (load, eject, floor, transport)
      sample-mixtapes.ts              Placeholder week of tapes ending today
      tape-date-labels.ts             Tape date labels (English, Japanese, spoken)
      use-stage-scale.ts              Fits the 1440x900 artboard to its container
      use-tape-drag.ts                Drag tapes between box, floor and player; click also loads
      FloorTape.tsx                   A cassette resting on the floor or being carried
      CassettePlayer.tsx, Cassette.tsx, JCard.tsx, TapeBox.tsx, ThemeLamp.tsx
      Headphones.tsx, RoomAtmosphere.tsx, FloorDecor.tsx
  test/                               Session, sample data and date label tests
packages/
  shared/
    src/
      ingestion-store.interface.ts    IngestionStore behavioral contract only
      track-matching-store.interface.ts  Provider match storage contract
      source-registry.interface.ts    Source registration contract
      source-validation.ts            Source key/configuration validation
      models.ts                       Feed, track, source and run data shapes
      errors.ts                       Application error codes and safe messages
      urls.ts                         Publisher-neutral URL validation and log sanitization
      index.ts                        Public exports
    test/
  db/
    src/
      client.ts                       Connections, bounded transactions and shutdown
      postgres-ingestion-store.ts     PostgreSQL implementation of IngestionStore
      postgres-track-matching-store.ts  Locked Spotify match writes and attempt diagnostics
      postgres-source-registry.ts     Insert-only source registration
      schema.ts                       Drizzle tables and constraints
      merge.ts                        Metadata merging and SHA-256 hashing
      connection.ts                   Connection URL and TLS validation
      deadline.ts                     Database operation deadlines and cancellation
      database-logging.ts             Sanitized database request/response pairs
      database-response-sanitization.ts  Allowed response fields, redaction and log limits
      errors.ts                       Driver error classification
      policy.ts                       Database limits
      index.ts                        connectDatabase wiring and public exports
    migrations/                       Applied SQL migration history and metadata
    test/                             Unit tests and separate PostgreSQL integration tests
  rss/
    src/
      models.ts                       HTTP options/responses and parsed feed data
      http-policy.ts                  HTTP timeout, retry and response-size limits
      text.ts                         Text and date parsing helpers
      source-adapter.interface.ts     Source fetching/enrichment contract
      source-adapters.ts              Publisher adapter selection and validation
      publishers/pitchfork/
        adapter.ts                    Pitchfork implementation of SourceAdapter
        urls.ts                       Pitchfork URL allowlist and normalization
        feed.ts                       Best New Tracks RSS parsing and fetching
        http.ts                       Validated Pitchfork HTTP requests and retries
        metadata.ts                   Review-page artist and track extraction
      index.ts                        Public exports
    test/fixtures/                    Synthetic RSS and review HTML fixtures
scripts/                              Lambda upload script and mocked-upload tests
infra/                                Undeployed CloudFormation design and wiring tests
docs/                                 Specification, operations and timing guides
certs/                                Public database CA certificate bundled with Lambda
```

## Selecting and registering sources

Pass a registered source key in the Lambda event:

```json
{ "sourceKey": "pitchfork_best_new_tracks" }
```

Each invocation follows this flow:

1. Read the required `sourceKey` from the Lambda event.
2. Load the source's feed URL, publisher `name`, `category`, enabled state and cache
   validators from Postgres, then select a compatible publisher adapter.
3. Fetch that stored URL and extract tracks using the selected adapter.
4. Upsert tracks into the database; new tracks are inserted and existing tracks
   retain the current metadata merge/update behavior.

Feed URLs are configuration in `ingestion_sources.feed_url`, with no runtime URL
constant or default source. Missing/invalid keys fail before connecting. Unknown
keys fail with `SOURCE_NOT_FOUND`, and disabled sources skip. Event-supplied URLs
are ignored. Completion logs include `sourceKey`. Update existing console test
payloads and scheduled events to include a registered key before using this code.

Local ingestion accepts the same selection:

```sh
pnpm ingest --source pitchfork_best_new_tracks
```

Register a source using this database-writing command, after explicitly authorizing
it for the database selected by your local `DATABASE_URL`:

```sh
pnpm sources:add --key pitchfork_copy --name pitchfork --category best_new_track --feed-url https://pitchfork.com/feed/reviews/best/tracks/rss
```

The command loads `.env` if present, validates arguments and adapter compatibility,
then inserts an enabled source with empty validators. Duplicate keys are rejected;
existing configuration and cache state are preserved. It does not fetch the feed,
ingest tracks or create a schedule. The runtime database role needs INSERT access
and an appropriate RLS policy on `ingestion_sources`. Use
`pnpm sources:add --help` for syntax without database access. Set `NODE_EXTRA_CA_CERTS`
as described below when your database requires the bundled CA.

Supported publisher/category: `pitchfork` / `best_new_track`. Its feed URL comes
from the source row; the adapter accepts HTTPS Pitchfork URLs under `/feed/` and
validates that the fetched content is a Best New Tracks feed. Registering another key for that feed creates independent
source/run/track records. A new publisher needs its own tested adapter for URL
validation, parsing and artist/title extraction; registration alone does not make
an arbitrary RSS feed compatible. A second publisher adapter is pending selection
of its feed URL.

`pnpm ingest:preview --source <key>` loads the same source row and previews the
current feed without writing source/run/track records. It loads `.env`, requires
read-only database access and fetches unconditionally. `pnpm ingest:fixture` uses
local synthetic Pitchfork files and needs neither a database nor network access.

## Deployment

`musicRssFetcher` in `us-east-2` is managed directly in the AWS Lambda console.
Environment variables have been set there manually. There is no active CDK or
CloudFormation deployment workflow; `infra/ingestion.template.json` is an
undeployed design, not the configuration of the existing function.

| Console setting       | Value                                                                        |
| --------------------- | ---------------------------------------------------------------------------- |
| Runtime / handler     | Node.js 24 / `index.handler`                                                 |
| Package               | ZIP, with `index.cjs` and `prod-ca-2021.crt` at its root                     |
| `DATABASE_URL`        | Private runtime PostgreSQL connection string; transaction pooler recommended |
| `NODE_EXTRA_CA_CERTS` | `/var/task/prod-ca-2021.crt`                                                 |
| Timeout               | 300 seconds recommended; verify in the console                               |

The execution role needs CloudWatch logging access. The function needs outbound
access to Pitchfork and the database. Other settings, including concurrency,
triggers, log retention and destinations, are maintained in the console.

```sh
pnpm upload:ingestion
# Override the default target/region/profile:
pnpm upload:ingestion musicRssFetcher us-east-2 music-discovery
```

The default target is
`arn:aws:lambda:us-east-2:783161622181:function:musicRssFetcher`, using the local
`music-discovery` AWS profile. All upload defaults are maintained in
[`scripts/lambda-targets.sh`](scripts/lambda-targets.sh), including the matcher
target `trackMatcher` in the same account and region. Update that file when a
console-managed function is renamed or replaced; it contains no credentials and
does not provision AWS resources. If the initial AWS check reports an expired session,
the script runs `aws login` with the same region/profile and retries that check once.
Complete the browser sign-in when prompted. Failed login, repeated expiry and other
AWS errors stop the upload before building; valid sessions do not trigger login.
The task validates the existing function, typechecks,
tests, builds, packages the handler and CA certificate, updates `$LATEST` with
revision protection, and waits for completion. It does **not** configure environment
variables, change other settings, publish versions, or invoke the function.
Local `.env` values are not uploaded. Test with a registered `sourceKey` in the console afterward, for example
`{"sourceKey":"pitchfork_best_new_tracks"}`.

`pnpm build:lambda` builds both `dist/ingestion/index.cjs` and
`dist/track-matcher/index.cjs` locally. `pnpm build:ingestion` and
`pnpm build:matcher` build just the selected app. For a manual
ZIP upload, include `certs/prod-ca-2021.crt` beside it. No `node_modules` is needed.
The upload task requires installed AWS CLI, pnpm and zip, plus
`lambda:GetFunctionConfiguration` and `lambda:UpdateFunctionCode`. A missing/empty CA stops the task before AWS calls.

The ingestion invocation contract is [`IngestionEvent`](apps/ingestion/src/models.ts).
Its [event parser](apps/ingestion/src/event-validation.ts) validates raw input before
database access; extra fields are ignored.

## Track matcher Lambda

The separately console-created track matcher uses the same Node.js 24 ZIP layout
and `index.handler` export as ingestion. Its function name/region are supplied
explicitly; the repository does not infer its live settings. Maintain its runtime,
role, networking, triggers and environment in the AWS console. Set:

- `DATABASE_URL` and `NODE_EXTRA_CA_CERTS=/var/task/prod-ca-2021.crt` as above.
- `SPOTIFY_CLIENT_ID` and `SPOTIFY_CLIENT_SECRET` from your Spotify developer app.
- `SPOTIFY_MARKET`, a two-letter uppercase market such as `US`.
- Timeout: 150 seconds recommended (120 seconds work plus 18.25 seconds cleanup).

Invoke it with a persisted editorial track UUID:

```json
{ "trackId": "00000000-0000-4000-8000-000000000001" }
```

The matcher invocation contract is [`TrackMatcherEvent`](apps/track-matcher/src/models.ts).
Its [event parser](apps/track-matcher/src/event-validation.ts) validates raw input
before database access. Both handler signatures use their specific event types
for TypeScript callers and editor hints. Runtime validation remains necessary
because incoming JSON can bypass TypeScript checks.

The UUID must identify an actual `tracks` row. Artist/title fields supplied in the
event are ignored. The result includes `trackId`, `provider: "spotify"`, and
`status` (`matched`, `not_found`, or `ambiguous`). A matched result also contains
`providerTrackId`, canonical public `providerUrl`, `providerTitle` and
`providerArtists` (stored attribution may be null for an existing manual match).
No playback token or audio URL is returned.

The matcher uses Spotify's [client credentials flow](https://developer.spotify.com/documentation/web-api/tutorials/client-credentials-flow)
and [catalog search](https://developer.spotify.com/documentation/web-api/reference/search).
It compares Unicode-normalized, case-insensitive titles and complete artist sets,
collapsing whitespace. Punctuation, accents and version suffixes remain meaningful.
It does not choose the first search hit or infer featured-artist credits. Distinct
qualifying provider IDs are ambiguous, including album/single duplicates. Search
is capped at five pages of ten results; an incomplete search is also ambiguous.
These conservative rules can leave valid recordings unresolved.

Successful lookups save `matched`, `not_found` or `ambiguous` in
`track_streaming_matches`. Established matches (including manual matches) are
preserved by repeated automatic lookups. Provider failures throw safe error codes
and update attempt/error fields without replacing a confirmed recording. A work
deadline skips diagnostic writes; failed diagnostic writes preserve the primary
error. Track identity changes during lookup reject the stale write. Ingestion
invalidates all provider rows when title or credited artists change, while review
metadata changes preserve them. This requires DELETE access/RLS on provider rows
for the ingestion database role, in addition to existing permissions. The matcher
role needs SELECT on tracks and SELECT/INSERT/UPDATE on streaming matches, with
suitable RLS policies. No grants, policies or migrations are applied by this change.

```sh
pnpm build:matcher
# After authorizing an upload, use the configured trackMatcher target:
pnpm upload:matcher
# Or override the target/region/profile:
pnpm upload:matcher <function-name> <region> [aws-profile]
```

The upload runs the same checks and packages the selected app's bundle and CA.
It changes code only; it does not set Spotify credentials, create triggers or invoke
Lambda. `pnpm upload:ingestion` selects ingestion; `pnpm upload:matcher` selects
the matcher. The matcher
requires outbound HTTPS to `accounts.spotify.com`, `api.spotify.com` and database
access. There is no automatic ingestion-to-matcher trigger or backfill yet. This
implementation has offline coverage; live Spotify access and hosted writes remain
unverified with your credentials.

## Uploading both Lambdas

`pnpm upload:lambda` uploads both applications, ingestion first and matcher second.
With no arguments it uses the shared defaults above. To override them, supply both
function names and their shared region; the AWS profile is optional:

```sh
pnpm upload:lambda <ingestion-function> <matcher-function> <region> [aws-profile]
```

It reuses each individual upload's validation, checks, packaging and revision
protection. If an upload fails,
the command stops; a successful earlier upload remains deployed. This is a
sequential release, with no rollback. Configure each function in the console
before authorizing uploads. Use `upload:ingestion` or `upload:matcher` to release
one app independently.

## Development

Use Node.js 24 and pnpm 12.8.1. Dependency installation requires explicit approval;
for an approved fresh checkout use `pnpm install --frozen-lockfile --ignore-scripts`.
Run that full install before any filtered `pnpm --filter <package> add`; a filtered
add in a fresh worktree links only the filtered package, leaving other workspace
packages unresolved. `pnpm-workspace.yaml` allows build scripts only for `supabase`
and `esbuild`; pnpm 12 fails installs that would skip any other package's scripts.

Prettier is pinned as a root development dependency. Run `pnpm format` to format
the workspace and `pnpm format:check` to check it without writing. Shared settings
live in `.prettierrc.json`; `.prettierignore` excludes generated output, local agent
settings, dependency locks, database migration history and parser fixtures. Prettier
also respects `.gitignore`. Shell scripts and SQL are not formatted by this setup.

| Command               | Purpose                                                                                             |
| --------------------- | --------------------------------------------------------------------------------------------------- |
| `pnpm ingest`         | Run with `--source <key>`; loads `.env`, reads source configuration and persists tracks/runs        |
| `pnpm ingest:preview` | Run with `--source <key>`; read source configuration from Postgres and print tracks without writing |
| `pnpm ingest:fixture` | Preview synthetic fixtures offline; no database                                                     |
| `pnpm typecheck`      | Check TypeScript, including the web app                                                             |
| `pnpm format`         | Format supported workspace files with Prettier                                                      |
| `pnpm format:check`   | Check formatting without changing files                                                             |
| `pnpm web:dev`        | Start the Vite dev server for `apps/web`                                                            |
| `pnpm web:build`      | Typecheck and build `apps/web` into `apps/web/dist`                                                 |
| `pnpm test`           | Offline application, template and mocked-upload tests                                               |
| `pnpm test:bundle`    | Build and smoke-test both Lambda bundles                                                            |
| `pnpm test:db`        | PostgreSQL integration tests; requires a pre-migrated disposable `TEST_DATABASE_URL`                |
| `pnpm db:generate`    | Generate migrations locally                                                                         |
| `pnpm db:migrate`     | Apply migrations using `DATABASE_MIGRATION_URL`; explicit authorization required                    |

Use `.env.example` for private local credentials. Runtime connections use verified
TLS and no prepared statements; migrations use a direct/session connection. When
using the Supabase CA locally, set it before Node starts:

```sh
NODE_EXTRA_CA_CERTS="$PWD/certs/prod-ca-2021.crt" pnpm ingest
# Substitute pnpm db:migrate only for an explicitly authorized migration.
```

The initial Supabase schema/source seed is applied history: preserve
`packages/db/migrations/0000_initial.sql` and add new migrations for schema changes.
Tables have RLS enabled; runtime grants/policies must permit source/run operations
and track reads/inserts/updates.
`pnpm db:migrate:local` and `pnpm test:db:local` read `.env.local` and allow no TLS
only on loopback hosts. They require an already-running local database. The normal
DB integration command does not load `.env`; live previews load `.env` for
read-only source lookup, while offline fixtures do not load credentials.
Hosted track-ingestion integration remains unverified.

## Web frontend

`apps/web` implements the "C5 · Anime" Listening Room design (day and night): a
tatami floor with a portable cassette player. Each day's recommendations are one
dated tape; the J-card lists its tracks and the "THIS WEEK" box holds the last
seven days. Run it with `pnpm web:dev`.

- Load a tape by dragging it onto the player, or by clicking it (keyboard: focus
  it and press Enter). OPEN ejects the tape back to the box.
- A tape dropped on the floor stays where it lands and can be picked up again;
  drop it on the box to put it away. The player itself does not move.
- Play/pause, stop, next and previous update the LCD and the highlighted track.
  Playback is visual only and the volume slider controls nothing: there is no
  audio source yet.
- The paper lamp switches theme; the first load follows the system light/dark
  setting. Animations stop when the system asks for reduced motion.
- The scene is a fixed 1440x900 artboard scaled as a whole to fit the window; there
  is no separate small-screen layout.
- Tapes and tracks are placeholders from `sample-mixtapes.ts`. No backend, database
  or network calls exist except loading the two Google Fonts in `index.html`.

## Streaming service matches

The additive migration
`packages/db/migrations/0001_track_streaming_matches.sql` adds an RLS-enabled
`track_streaming_matches` table. One editorial track can have one confirmed
recording per provider (for example, Spotify and SoundCloud); the primary key is
`(track_id, provider)`. Different review/source rows may reference the same provider
recording. The existing `tracks` identity and ingestion behavior are unchanged.

The table stores durable provider identifiers, public attribution links, optional
recording/uploader metadata, and matching status. It stores neither audio nor stream
URLs, tokens, or listener playback eligibility. The track matcher above implements
Spotify search and persistence; automatic scheduling, backfill and playback are
not implemented. Migration `0001` was applied to the configured Supabase database
with explicit authorization on 2026-11-12; its journal hash, columns, constraints and
RLS state were verified with read-only queries. Other databases still require an
explicitly authorized migration. It adds no grants or access policies. See the
[streaming match contract](docs/ingestion-spec.md#streaming-match-schema) for fields
and future writer responsibilities.

## Documentation

- [Agent worktrees and human review](AGENTS.md#agent-worktrees-and-human-review): repository expectations for task isolation, PR feedback and post-merge cleanup.
- [Stereogum evaluation](docs/sources/stereogum.md): mixed feed structure and proposed track extraction scope.
- [Operations](docs/operations.md): configuration, logs, outcomes and recovery.
- [Implementation specification](docs/ingestion-spec.md): parsing and lifecycle contracts.
- [Timing and policies](docs/timing-and-policies.md): limit ownership, deadline relationships and tuning.
- [Infrastructure status](infra/README.md): console ownership and retained template.
- [TASKS.md](TASKS.md): historical decisions and verification; older entries may be superseded.
