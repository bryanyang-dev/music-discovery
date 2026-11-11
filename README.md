# Music discovery

Fetch Pitchfork Best New Tracks and enrich each entry from its review page using
TypeScript and AWS Lambda. The handler logs parsed feeds and tracks, records runs
in PostgreSQL, and closes database connections after each invocation. Track
upserts are temporarily disabled while reviewing extracted metadata.

The Supabase schema and source seed have been migrated. The upload task packages
the handler and database CA certificate for `musicRssFetcher`; configure
`DATABASE_URL` and `NODE_EXTRA_CA_CERTS` in the Lambda environment separately.

## Structure

```text
apps/ingestion/src/handler.ts  Database ingestion Lambda entry point
apps/ingestion/src/local.ts    Local RSS and enriched-track previews
apps/ingestion/src/run.ts      Feed enrichment, logging and run tracking
apps/ingestion/src/timing.ts   Database ingestion work limit
packages/rss                  HTTP, RSS parsing, review metadata extraction
packages/db                   PostgreSQL schema, migrations, and persistence
packages/shared               Shared contracts, source constants, and helpers
scripts/upload-lambda.sh      Build, test, package, and update a test Lambda
infra                         Future hourly database ingestion infrastructure
```

## Local development

Use Node.js 24 and pnpm 12.8.1. Dependency installation requires explicit approval.
For an approved fresh checkout, the installation command is:

```sh
pnpm install --frozen-lockfile --ignore-scripts
```

Existing commands:

| Command | Purpose |
| --- | --- |
| `pnpm ingest` | Fetch, log, and return RSS; no database access |
| `pnpm ingest:preview` | Fetch RSS and linked reviews; print enriched tracks |
| `pnpm ingest:fixture` | Preview enriched tracks using offline fixtures |
| `pnpm typecheck` | Check TypeScript, including unused locals and parameters |
| `pnpm test` | Run application, infrastructure, and upload-script tests offline |
| `pnpm test:bundle` | Build and smoke-test the actual Lambda bundle |
| `pnpm test:db` | Run real PostgreSQL tests when TEST_DATABASE_URL is provided |
| `pnpm db:generate` | Generate SQL migrations locally from the schema |
| `pnpm db:migrate` | Apply migrations using Drizzle Kit; requires authorization |

Tests use synthetic fixtures and mocked network/AWS calls. The separate database
integration suite skips without TEST_DATABASE_URL and does not load `.env`.
Local `pnpm ingest` loads `.env` if present; previews do not. Credentials and
build artifacts are ignored by Git.

## RSS behavior and logs

The handler fetches the fixed Pitchfork feed URL and returns its parsed response.
Malformed individual entries appear in `response.feed.errors`; a feed/network
failure throws a sanitized error and fails the invocation.

Transient failures get up to three retries after the initial attempt: four
attempts maximum, with exponential waits of 1, 2, and 4 seconds. Longer Retry-After
values are honored. Nested HTTP retries are disabled for this handler.

Requests and waits share a 30-second maximum budget. Under Lambda, that budget
is capped at remaining invocation time minus 250 milliseconds for logging/return.
A short invocation can run out of time before all retries are used.

Every JSON log record includes the AWS request ID, attempt number, and level:

| Level / console method | Events |
| --- | --- |
| INFO / `console.log` | `rss_fetch_started`, `rss_fetch_succeeded` |
| WARN / `console.warn` | `rss_fetch_attempt_failed`, `rss_fetch_retry_scheduled` |
| ERROR / `console.error` | `rss_fetch_aborted`, `rss_fetch_max_attempts_reached`, `rss_fetch_failed` |

Success logs include the parsed response. Retry logs include the delay in
milliseconds. Error logs contain safe codes, not raw exception messages.

## Upload to the test Lambda

```sh
pnpm upload:lambda
```

Defaults: `arn:aws:lambda:us-east-2:783161622181:function:musicRssFetcher`, region
`us-east-2`, local AWS CLI profile `music-discovery`. To override them:

```sh
pnpm upload:lambda musicRssFetcher us-east-2 music-discovery
```

The function must already exist with Node.js 24, ZIP packaging, handler
`index.handler`, durable execution disabled, and an execution role with CloudWatch
logging permissions. Configure `DATABASE_URL` with runtime database credentials and
network access to PostgreSQL. A 300-second timeout is recommended for sequential
review enrichment; the handler caps work at 240 seconds and reserves 24.25 seconds
for database cleanup and return. Set `NODE_EXTRA_CA_CERTS` to
`/var/task/prod-ca-2021.crt` in the Lambda environment to trust the bundled
Supabase CA certificate.

The script uses already-installed AWS CLI, pnpm, and zip. It checks the target,
then typechecks, tests, builds, smoke-tests, packages `index.cjs` and
`certs/prod-ca-2021.crt` at the ZIP root,
updates `$LATEST`, and waits for the update to complete. The caller needs
`lambda:GetFunctionConfiguration`, `lambda:GetFunction`, and
`lambda:UpdateFunctionCode` on the target. A named profile is passed to every AWS
command; explicit target/region arguments without a profile use normal AWS CLI
credential selection.

The script protects against concurrent deployments with a revision ID and removes
its temporary archive on exit. Failed checks stop the upload; a failure after AWS
accepts an update does not roll back code. It does not change configuration, publish
versions, move aliases, or invoke the function. Test manually with `{}` afterward.

For a manual console upload, `pnpm build:lambda` writes
`dist/ingestion/index.cjs`, exporting `handler`. The bundle contains the RSS
and database runtime dependencies; no `node_modules` upload is needed. Include
`certs/prod-ca-2021.crt` beside `index.cjs` in manual uploads as well. The upload
script fails before contacting AWS if this certificate is missing or empty.

## Supabase

Keep runtime DATABASE_URL and migration DATABASE_MIGRATION_URL private, using
`.env.example` as the template. The database package uses standard PostgreSQL and
Drizzle. Runtime connections use transaction pooling with prepared statements
disabled; migrations use a direct or session-pooled connection. TLS verification
is required. Schema generation is local; applying migrations is always explicit.

`pnpm db:migrate` runs Drizzle Kit's built-in migration command with
`drizzle.migrate.config.ts`, reading `.env`. For the existing Supabase CA:

```sh
NODE_EXTRA_CA_CERTS="$PWD/certs/prod-ca-2021.crt" pnpm db:migrate
```

`pnpm db:migrate:local` reads `.env.local` and explicitly permits no TLS only for
loopback connections. Generation uses `drizzle.config.ts` and needs no credentials.
Drizzle Kit owns migration execution, connection lifecycle and error reporting.

Track writes are temporarily commented out for inspection. The handler emits
`track_extracted` logs with enriched track metadata and `writeSkipped: true`.
Database run tracking remains active, so `DATABASE_URL` is still required.
Feed validators are bypassed and cleared so repeated runs log every track;
inserted, updated and unchanged counts remain zero until upserts are restored.

The handler and `pnpm ingest` call `ingestPitchfork` using `DATABASE_URL`. Each RSS
entry is enriched from its review page to obtain the required artist metadata
and logged for inspection. The database store supports upserts by source and
canonical review URL when track writes are restored. The handler returns a run summary
with inserted, updated, unchanged and rejected counts. Invalid reviews are recorded
without blocking later entries. Failed runs throw sanitized errors after recording
the run; connections close on success and failure.

The schema and Pitchfork source seed are deployed with RLS enabled. Runtime-role
permissions/RLS policies and hosted ingestion verification still need to be checked
before a production run. No infrastructure deployment is part of this code change.

The initial migration creates only `ingestion_sources`, `tracks`, and
`ingestion_runs`, and seeds the Pitchfork source. The unused feeds/articles schema
was removed before any migrations were applied. Once migrations have been applied,
preserve their history and generate new migrations for subsequent schema changes.

- [Database ingestion specification](docs/ingestion-spec.md)
- [Current RSS and future database operations](docs/operations.md)
- [Future infrastructure and deployment prerequisites](infra/README.md)
- [Implementation history and checks](TASKS.md)
- [Supabase connection modes](https://supabase.com/docs/guides/database/connecting-to-postgres)
- [Supabase with Drizzle](https://supabase.com/docs/guides/database/drizzle)
