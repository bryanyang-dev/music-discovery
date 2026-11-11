# Music discovery

Fetch and parse Pitchfork Best New Tracks with a TypeScript AWS Lambda handler.
The current handler logs and returns RSS data without database access. PostgreSQL
storage and review-page enrichment are implemented separately for the next
Supabase integration step; no remote database migration has been performed.

The latest local handler includes retries, deadline handling, and severity-based
logging. It has not yet been uploaded to the current target, `musicRssFetcher`.

## Structure

```text
apps/ingestion/src/handler.ts  RSS-only Lambda entry point
apps/ingestion/src/local.ts    Local RSS and enriched-track previews
apps/ingestion/src/run.ts      Database ingestion service, not wired to the handler
apps/ingestion/src/timing.ts   Database ingestion work/lease limits
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
| `pnpm db:migrate` | Apply migrations to the configured database; requires authorization |

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
logging permissions. A 30-second timeout is recommended; the default three seconds
may be too short for a live RSS request. No VPC or database settings are needed.

The script uses already-installed AWS CLI, pnpm, and zip. It checks the target,
then typechecks, tests, builds, smoke-tests, packages `index.cjs` at the ZIP root,
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
runtime dependencies; no `node_modules` upload is needed.

## Next: Supabase

Keep runtime DATABASE_URL and migration DATABASE_MIGRATION_URL private, using
`.env.example` as the template. The database package uses standard PostgreSQL and
Drizzle. Runtime connections use transaction pooling with prepared statements
disabled; migrations use a direct or session-pooled connection. TLS verification
is required. Schema generation is local; applying migrations is always explicit.

The current handler does not call `ingestPitchfork` or write to PostgreSQL. Setting
environment variables or running `pnpm ingest` does not enable database ingestion.
Supabase provisioning, migration review, role/RLS setup, integration testing, and
wiring the service into Lambda are the next stage.

The existing legacy feeds/articles schema and migration are retained to preserve
the database history. Do not delete or regenerate migration history as cleanup.

- [Database ingestion specification](docs/ingestion-spec.md)
- [Current RSS and future database operations](docs/operations.md)
- [Future infrastructure and deployment prerequisites](infra/README.md)
- [Implementation history and checks](TASKS.md)
- [Supabase connection modes](https://supabase.com/docs/guides/database/connecting-to-postgres)
- [Supabase with Drizzle](https://supabase.com/docs/guides/database/drizzle)
