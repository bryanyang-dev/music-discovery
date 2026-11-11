# Music discovery

A TypeScript AWS Lambda fetches Pitchfork Best New Tracks, enriches entries from
review pages, and logs parsed feeds and tracks. Supabase stores source/run records.
**Track upserts are temporarily disabled**; inserted/updated/unchanged counts stay
zero. Feed caching is bypassed so repeated runs inspect every current entry.

## Deployment

`musicRssFetcher` in `us-east-2` is managed directly in the AWS Lambda console.
Environment variables have been set there manually. There is no active CDK or
CloudFormation deployment workflow; `infra/ingestion.template.json` is an
undeployed design, not the configuration of the existing function.

| Console setting | Value |
| --- | --- |
| Runtime / handler | Node.js 24 / `index.handler` |
| Package | ZIP, with `index.cjs` and `prod-ca-2021.crt` at its root |
| `DATABASE_URL` | Private runtime PostgreSQL connection string; transaction pooler recommended |
| `NODE_EXTRA_CA_CERTS` | `/var/task/prod-ca-2021.crt` |
| Timeout | 300 seconds recommended; verify in the console |

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
`music-discovery` AWS profile. The task validates the existing function, typechecks,
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

| Command | Purpose |
| --- | --- |
| `pnpm ingest` | Run the handler locally; loads `.env`, requires database access, logs feeds/tracks and records runs |
| `pnpm ingest:preview` | Fetch RSS/reviews and print enriched metadata; no database |
| `pnpm ingest:fixture` | Preview synthetic fixtures offline; no database |
| `pnpm typecheck` | Check TypeScript |
| `pnpm test` | Offline application, template and mocked-upload tests |
| `pnpm test:bundle` | Build and smoke-test the Lambda bundle |
| `pnpm test:db` | PostgreSQL integration tests; requires a pre-migrated disposable `TEST_DATABASE_URL` |
| `pnpm db:generate` | Generate migrations locally |
| `pnpm db:migrate` | Apply migrations using `DATABASE_MIGRATION_URL`; explicit authorization required |

Use `.env.example` for private local credentials. Runtime connections use verified
TLS and no prepared statements; migrations use a direct/session connection. When
using the Supabase CA locally, set it before Node starts:

```sh
NODE_EXTRA_CA_CERTS="$PWD/certs/prod-ca-2021.crt" pnpm ingest
# Substitute pnpm db:migrate only for an explicitly authorized migration.
```

The initial Supabase schema/source seed is applied history: preserve
`packages/db/migrations/0000_initial.sql` and add new migrations for schema changes.
Tables have RLS enabled; runtime grants/policies must permit source/run operations.
`pnpm db:migrate:local` and `pnpm test:db:local` read `.env.local` and allow no TLS
only on loopback hosts. They require an already-running local database. The normal
DB integration command does not load `.env`; previews do not load credentials.
Hosted track-ingestion integration remains unverified.

## Code and documentation

- `apps/ingestion/src/`: Lambda/local entry points, orchestration and timing.
- `packages/rss/`: HTTP, RSS parsing and review metadata extraction.
- `packages/db/`: schema, migrations, database operations and error classification.
- `packages/shared/`: contracts, URL validation and descriptive errors.
- [Operations](docs/operations.md): configuration, logs, outcomes and recovery.
- [Implementation specification](docs/ingestion-spec.md): parsing and lifecycle contracts.
- [Timing and policies](docs/timing-and-policies.md): limit ownership, deadline relationships and tuning.
- [Infrastructure status](infra/README.md): console ownership and retained template.
- [TASKS.md](TASKS.md): historical decisions and verification; older entries may be superseded.
