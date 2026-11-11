# Music discovery — Pitchfork ingestion

Hourly discovery of Pitchfork **Best New Tracks**, ready to run as an AWS Lambda
event function. Uses TypeScript, pnpm, Drizzle, and Supabase-compatible Postgres.

**Nothing is deployed. No remote database has been migrated.**

- [Implementation task board and work log](TASKS.md)
- [Pipeline specification and decisions](docs/ingestion-spec.md)
- [Operational runbook](docs/operations.md)
- [Undeployed AWS infrastructure](infra/README.md)

## Structure

```text
apps/ingestion/src/handler.ts  Lambda entry point
apps/ingestion/src/run.ts      One source's ingestion lifecycle
apps/ingestion/src/local.ts    Thin local run/preview wrapper (not a CLI product)
packages/rss                  Safe HTTP, RSS discovery, review metadata extraction
packages/db                   Schema, migrations, source leases, track upserts
packages/shared               Contracts, source constants, URL/error helpers
infra                         Reviewable disabled-by-default AWS template and tests
apps/web, apps/api            Future placeholders only
```

The old generic feed-management CLI has been removed. There is no feed-registration
command: the additive migration seeds the single agreed source automatically.

## Prerequisites

Node 24 LTS and pnpm 12.8.1. Dependencies are already installed in the working copy.
No dependencies were installed or upgraded during the Pitchfork implementation.

For a fresh checkout, review and explicitly approve the exact installation command
under your dependency policy before running:

```sh
pnpm install --frozen-lockfile --ignore-scripts
```

Workspace packages export TypeScript for local execution with tsx. Production
bundles all runtime dependencies into a CommonJS Lambda artifact.

## Try it without credentials

```sh
pnpm ingest:fixture
pnpm typecheck
pnpm test
pnpm test:bundle
```

The fixture preview is completely offline. Tests use synthetic fixtures and do not
contact Pitchfork or a database. The bundle test builds and loads the actual Lambda
artifact, including the RSS parser and Postgres driver.

For a read-only live preview (RSS plus linked reviews; no database writes):

```sh
pnpm ingest:preview
```

Live preview intentionally does not load .env. It is a manual diagnostic, not the
scheduled worker. As of implementation verification, all 30 entries returned by the
public feed could be normalized with credited artists.

## Set up a development database

1. Select a disposable/development Supabase project, not production.
2. Copy the example without overwriting an existing environment file:

   ```sh
   cp -n .env.example .env
   ```

3. Privately set DATABASE_URL to the **transaction pooler** URL from Supabase's
   Connect panel (usually port 6543). URL-encode password special characters.
4. Set DATABASE_MIGRATION_URL to a **direct or session pooler** connection (usually
   port 5432). A direct connection may need IPv6; session pooling supports IPv4.
5. Verify the project/database and review both migration SQL files before:

   ```sh
   pnpm db:migrate
   pnpm ingest
   ```

The migration creates the track/source/run tables and idempotently seeds
pitchfork_best_new_tracks. Each run imports the current feed, not an archive.
Legacy feeds/articles tables remain represented and untouched so the original
scaffold migration is not destructive. They are unused by the new worker, and
legacy article data is not silently converted into tracks.

TLS certificate verification is mandatory in normal runtime. Use NODE_EXTRA_CA_CERTS
if your database requires a trusted custom CA; never disable verification to make
a production connection work. Prepared statements are disabled and each invocation
uses at most one client connection for transaction-pooler compatibility.

All active tables enable RLS without public policies. Development can use a trusted
database-owner connection. Before production, configure a dedicated runtime role
with only the needed table privileges and appropriate server-role RLS policies.
Keep migration privileges separate. Do not use a Supabase public API key as a
Postgres password or expose database-owner credentials to a frontend.

## Schema changes

```sh
pnpm db:generate
```

This only generates local SQL/snapshot files. Review the SQL and then deliberately
run db:migrate against the intended development database. The migration runner never
runs inside Lambda or automatically during tests/builds.

## Real Postgres integration tests

The integration suite is separate and skips unless TEST_DATABASE_URL is explicitly
set in the process environment. It does **not** load your .env file.

1. Migrate a disposable development database using the normal migration process.
2. Set TEST_DATABASE_URL privately to that database.
3. Run:

```sh
pnpm test:db
```

Tests create randomly named source records, verify real upserts/run transactions,
exercise competing clients and expired fencing tokens, and delete only their own
tracks/runs/sources afterward. Do not use production.

For an existing loopback-only test Postgres without TLS, explicitly set
TEST_DATABASE_ALLOW_LOCAL_NO_TLS=1 in addition to TEST_DATABASE_URL. The bypass is
rejected for remote hosts and is never used by the production handler.

Integration tests have not run in this session: no disposable test database was
provided, no local Postgres binaries exist, and the Docker daemon is unavailable.
No database service was started and no container image was pulled.

## Lambda deployment boundary

```sh
pnpm build:lambda
```

Output: dist/ingestion/index.cjs; handler: index.handler; runtime: nodejs24.x.

The undeployed CloudFormation template schedules hourly UTC invocations, reserves
one execution, configures separate delivery/execution failure queues, and includes
alarms. The schedule is **disabled by default**. DATABASE_URL is supplied through an
existing Secrets Manager secret at deployment, not embedded in source or payloads.

Read infra/README.md before any deployment. Confirm the selected Region
(us-east-2), plan/service availability, costs, database role/connection, artifact,
alarm destination, and secret rotation process. No upload, provisioning, cloud
invocation, schedule enablement, or commit has been performed.

## References

- [Pitchfork's RSS directory](https://pitchfork.com/info/rss/)
- [Best New Tracks RSS](https://pitchfork.com/feed/reviews/best/tracks/rss)
- [Supabase connection modes](https://supabase.com/docs/guides/database/connecting-to-postgres)
- [Supabase with Drizzle](https://supabase.com/docs/guides/database/drizzle)
- [Drizzle transactions](https://orm.drizzle.team/docs/transactions)
