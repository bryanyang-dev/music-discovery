# Music discovery

A TypeScript AWS Lambda fetches Pitchfork Best New Tracks, enriches entries from
review pages, logs parsed metadata, and upserts tracks into Supabase alongside
source/run records. Results report inserted, updated, unchanged and rejected counts.
Successful runs save feed validators; unchanged feeds skip review fetches and writes.

## Project structure

This pnpm workspace separates the ingestion application, storage contract,
PostgreSQL implementation and publisher HTTP/parsing code. Key files:

```text
apps/ingestion/
  src/
    handler.ts                        Entry point for ingestion lambda
    run.ts                            Feed enrichment and track persistence workflow
    local.ts                          Local handler and read-only preview commands
    timing.ts                         Overall work and cleanup budgets
  test/                               Handler, workflow, timing and bundle tests
packages/
  shared/
    src/
      ingestion-store.interface.ts    IngestionStore behavioral contract only
      models.ts                       Feed, track, source and run data shapes
      errors.ts                       Application error codes and safe messages
      pitchfork.ts                    Source constants, URL rules and identity hashing
      index.ts                        Public exports
    test/
  db/
    src/
      client.ts                       Connections, bounded transactions and shutdown
      postgres-ingestion-store.ts     PostgreSQL implementation of IngestionStore
      schema.ts                       Drizzle tables and constraints
      merge.ts                        Metadata merging and hashing
      connection.ts                   Connection URL and TLS validation
      deadline.ts                     Database operation deadlines and cancellation
      errors.ts                       Driver error classification
      policy.ts                       Database limits
      index.ts                        connectDatabase wiring and public exports
    migrations/                       Applied SQL migration history and metadata
    test/                             Unit tests and separate PostgreSQL integration tests
  rss/
    src/
      http.ts                         Validated HTTP requests and retries
      http-policy.ts                  HTTP timeout, retry and response-size limits
      metadata.ts                     Review-page track extraction
      text.ts                         Text and date parsing helpers
      index.ts                        RSS parsing, feed fetching and public exports
    test/fixtures/                    Synthetic RSS and review HTML fixtures
scripts/                              Lambda upload script and mocked-upload tests
infra/                                Undeployed CloudFormation design and wiring tests
docs/                                 Specification, operations and timing guides
certs/                                Public database CA certificate bundled with Lambda
```

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
pnpm upload:lambda
# Override the default target/region/profile:
pnpm upload:lambda musicRssFetcher us-east-2 music-discovery
```

The default target is
`arn:aws:lambda:us-east-2:783161622181:function:musicRssFetcher`, using the local
`music-discovery` AWS profile. If the initial AWS check reports an expired session,
the script runs `aws login` with the same region/profile and retries that check once.
Complete the browser sign-in when prompted. Failed login, repeated expiry and other
AWS errors stop the upload before building; valid sessions do not trigger login.
The task validates the existing function, typechecks,
tests, builds, packages the handler and CA certificate, updates `$LATEST` with
revision protection, and waits for completion. It does **not** configure environment
variables, change other settings, publish versions, or invoke the function.
Local `.env` values are not uploaded. Test with `{}` in the console afterward.

`pnpm build:lambda` only writes `dist/ingestion/index.cjs` locally. For a manual
ZIP upload, include `certs/prod-ca-2021.crt` beside it. No `node_modules` is needed.
The upload task requires installed AWS CLI, pnpm and zip, plus
`lambda:GetFunctionConfiguration` and `lambda:UpdateFunctionCode`. A missing/empty CA stops the task before AWS calls.

## Development

Use Node.js 24 and pnpm 12.8.1. Dependency installation requires explicit approval;
for an approved fresh checkout use `pnpm install --frozen-lockfile --ignore-scripts`.

| Command               | Purpose                                                                                                         |
| --------------------- | --------------------------------------------------------------------------------------------------------------- |
| `pnpm ingest`         | Run the handler locally; loads `.env`, requires database access, logs metadata, upserts tracks and records runs |
| `pnpm ingest:preview` | Fetch RSS/reviews and print enriched metadata; no database                                                      |
| `pnpm ingest:fixture` | Preview synthetic fixtures offline; no database                                                                 |
| `pnpm typecheck`      | Check TypeScript                                                                                                |
| `pnpm test`           | Offline application, template and mocked-upload tests                                                           |
| `pnpm test:bundle`    | Build and smoke-test the Lambda bundle                                                                          |
| `pnpm test:db`        | PostgreSQL integration tests; requires a pre-migrated disposable `TEST_DATABASE_URL`                            |
| `pnpm db:generate`    | Generate migrations locally                                                                                     |
| `pnpm db:migrate`     | Apply migrations using `DATABASE_MIGRATION_URL`; explicit authorization required                                |

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
DB integration command does not load `.env`; previews do not load credentials.
Hosted track-ingestion integration remains unverified.

## Documentation

- [Operations](docs/operations.md): configuration, logs, outcomes and recovery.
- [Implementation specification](docs/ingestion-spec.md): parsing and lifecycle contracts.
- [Timing and policies](docs/timing-and-policies.md): limit ownership, deadline relationships and tuning.
- [Infrastructure status](infra/README.md): console ownership and retained template.
- [TASKS.md](TASKS.md): historical decisions and verification; older entries may be superseded.
