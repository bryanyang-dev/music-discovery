import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { and, eq, or, isNull, sql } from "drizzle-orm";
import { IngestionError, MAX_RUN_ERROR_COUNT, type IngestionStore, type SourceLease, type TrackInput } from "@music-discovery/shared";
import { ingestionRuns, ingestionSources, tracks } from "./schema.ts";
import { mergeTrack, metadataHash } from "./merge.ts";
import { boundDatabaseOperation } from "./deadline.ts";
import { DATABASE_POLICY } from "./policy.ts";

interface DatabaseOptions {
  localTest?: boolean;
  signal?: AbortSignal;
}

interface TransactionOptions {
  phase?: "work" | "cleanup";
}

export function connectDatabase(connectionString: string, options: DatabaseOptions = {}) {
  const parsed = new URL(connectionString);
  if (!["postgres:", "postgresql:"].includes(parsed.protocol)) {
    throw new IngestionError("DATABASE_ERROR");
  }
  if (options.localTest && !["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname)) {
    throw new IngestionError("DATABASE_ERROR");
  }
  const client = postgres(connectionString, {
    prepare: false,
    max: DATABASE_POLICY.maxConnectionCount,
    ssl: options.localTest ? false : "verify-full",
    connect_timeout: DATABASE_POLICY.connectTimeoutSeconds,
    idle_timeout: DATABASE_POLICY.idleTimeoutSeconds,
    connection: { application_name: "music-discovery-ingestion" },
  });
  const db = drizzle(client);
  type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

  async function inTransaction<Result>(
    work: (transaction: Transaction) => Promise<Result>,
    transactionOptions: TransactionOptions = {},
  ): Promise<Result> {
    const isCleanup = transactionOptions.phase === "cleanup";
    const deadlineOptions = !isCleanup && options.signal ? { signal: options.signal } : {};

    return boundDatabaseOperation(
      () => db.transaction(async (transaction) => {
        await transaction.execute(sql`SELECT set_config('statement_timeout', ${String(DATABASE_POLICY.statementTimeoutMs)}, true)`);
        await transaction.execute(sql`SELECT set_config('lock_timeout', ${String(DATABASE_POLICY.lockTimeoutMs)}, true)`);
        return work(transaction);
      }),
      () => client.end({ timeout: DATABASE_POLICY.forceCloseTimeoutSeconds }),
      deadlineOptions,
    );
  }

  async function assertLease(transaction: Transaction, lease: SourceLease) {
    const [source] = await transaction.select({ id: ingestionSources.id }).from(ingestionSources)
      .where(and(
        eq(ingestionSources.id, lease.id), eq(ingestionSources.leaseToken, lease.token),
        sql`${ingestionSources.leaseExpiresAt} > clock_timestamp()`,
      )).for("update");
    if (!source) {
      throw new IngestionError("LEASE_LOST");
    }
  }

  function activeRun(lease: SourceLease, runId: string) {
    return and(eq(ingestionRuns.id, runId), eq(ingestionRuns.sourceId, lease.id),
      eq(ingestionRuns.leaseToken, lease.token), eq(ingestionRuns.status, "running"));
  }

  async function requireRunUpdate(
    transaction: Transaction, lease: SourceLease, runId: string,
    patch: Partial<typeof ingestionRuns.$inferInsert>,
  ) {
    const saved = await transaction.update(ingestionRuns).set(patch)
      .where(activeRun(lease, runId)).returning({ id: ingestionRuns.id });
    if (!saved.length) {
      throw new IngestionError("LEASE_LOST");
    }
  }

  async function incrementRunCounter(
    transaction: Transaction,
    lease: SourceLease,
    runId: string,
    outcome: "inserted" | "updated" | "unchanged",
  ): Promise<void> {
    const counter = ingestionRuns[outcome];
    const saved = await transaction.update(ingestionRuns)
      .set({ [outcome]: sql`${counter} + 1` })
      .where(activeRun(lease, runId))
      .returning({ id: ingestionRuns.id });
    if (!saved.length) {
      throw new IngestionError("LEASE_LOST");
    }
  }

  const store: IngestionStore = {
    async acquireSource(sourceKey, leaseSeconds) {
      if (!Number.isInteger(leaseSeconds) || leaseSeconds < DATABASE_POLICY.minimumLeaseSeconds || leaseSeconds > DATABASE_POLICY.maximumLeaseSeconds) {
        throw new IngestionError("DATABASE_ERROR");
      }
      return inTransaction(async (transaction) => {
        const token = randomUUID();
        const [source] = await transaction.update(ingestionSources).set({
          leaseToken: token,
          leaseExpiresAt: sql`clock_timestamp() + ${leaseSeconds} * interval '1 second'`,
          lastAttemptAt: sql`clock_timestamp()`,
        }).where(and(
          eq(ingestionSources.key, sourceKey), eq(ingestionSources.enabled, true),
          or(isNull(ingestionSources.leaseToken), sql`${ingestionSources.leaseExpiresAt} <= clock_timestamp()`),
        )).returning();
        if (!source) {
          const [existing] = await transaction.select({ enabled: ingestionSources.enabled }).from(ingestionSources)
            .where(eq(ingestionSources.key, sourceKey));
          if (!existing) {
            throw new IngestionError("SOURCE_NOT_FOUND");
          }
          return null;
        }
        const interrupted = await transaction.update(ingestionRuns).set({
          status: "failed",
          finishedAt: sql`clock_timestamp()`,
          errors: [{ code: "INTERRUPTED_RUN", sourceUrl: null }],
        }).where(and(eq(ingestionRuns.sourceId, source.id), eq(ingestionRuns.status, "running")))
          .returning({ id: ingestionRuns.id });
        if (interrupted.length) {
          await transaction.update(ingestionSources).set({ etag: null, lastModified: null })
            .where(eq(ingestionSources.id, source.id));
          source.etag = null;
          source.lastModified = null;
        }
        return { id: source.id, feedUrl: source.feedUrl, enabled: source.enabled,
          etag: source.etag, lastModified: source.lastModified, token };
      });
    },
    async beginRun(lease) {
      return inTransaction(async (transaction) => {
        await assertLease(transaction, lease);
        const [run] = await transaction.insert(ingestionRuns).values({ sourceId: lease.id, leaseToken: lease.token })
          .returning({ id: ingestionRuns.id });
        if (!run) {
          throw new IngestionError("DATABASE_ERROR");
        }
        return run.id;
      });
    },
    async recordDiscovery(lease, runId, found, errors) {
      await inTransaction(async (transaction) => {
        await assertLease(transaction, lease);
        await requireRunUpdate(transaction, lease, runId, {
          found,
          rejected: errors.length,
          errors: errors.slice(0, MAX_RUN_ERROR_COUNT),
        });
      });
    },
    async rejectEntry(lease, runId, issue) {
      await inTransaction(async (transaction) => {
        await assertLease(transaction, lease);
        const saved = await transaction.update(ingestionRuns).set({
          rejected: sql`${ingestionRuns.rejected} + 1`,
          errors: sql`CASE WHEN jsonb_array_length(${ingestionRuns.errors}) < ${MAX_RUN_ERROR_COUNT}
            THEN ${ingestionRuns.errors} || ${JSON.stringify([issue])}::jsonb ELSE ${ingestionRuns.errors} END`,
        }).where(activeRun(lease, runId)).returning({ id: ingestionRuns.id });
        if (!saved.length) {
      throw new IngestionError("LEASE_LOST");
    }
      });
    },
    async upsertTrack(lease, runId, incoming) {
      if (!incoming.trackTitle.trim() || !incoming.artists.length || incoming.artists.some((artist) => !artist.trim())) {
        throw new IngestionError("INVALID_ENTRY");
      }
      return inTransaction(async (transaction) => {
        await assertLease(transaction, lease);
        const [previous] = await transaction.select().from(tracks)
          .where(and(eq(tracks.sourceId, lease.id), eq(tracks.sourceUrl, incoming.sourceUrl)));
        const merged = mergeTrack(incoming, previous);
        const hash = metadataHash(merged);
        if (previous?.metadataHash === hash) {
          await transaction.update(tracks).set({ lastSeenAt: sql`clock_timestamp()` }).where(eq(tracks.id, previous.id));
          await incrementRunCounter(transaction, lease, runId, "unchanged");
          return "unchanged";
        }
        await transaction.insert(tracks).values({ ...merged, sourceId: lease.id, metadataHash: hash })
          .onConflictDoUpdate({
            target: [tracks.sourceId, tracks.sourceUrl],
            set: { ...merged, metadataHash: hash, lastSeenAt: sql`clock_timestamp()`, updatedAt: sql`clock_timestamp()` },
          });
        const outcome = previous ? "updated" : "inserted";
        await incrementRunCounter(transaction, lease, runId, outcome);
        return outcome;
      });
    },
    async finishRun(lease, result, validators) {
      return inTransaction(async (transaction) => {
        await assertLease(transaction, lease);
        const finished = await transaction.update(ingestionRuns).set({
          status: result.status,
          finishedAt: sql`clock_timestamp()`,
          notModified: result.notModified,
          errors: result.errors.slice(0, MAX_RUN_ERROR_COUNT),
        }).where(activeRun(lease, result.runId)).returning();
        if (!finished.length) {
          throw new IngestionError("LEASE_LOST");
        }
        await transaction.update(ingestionSources).set(result.status === "succeeded" ? {
          lastSuccessAt: sql`clock_timestamp()`, etag: validators?.etag ?? null,
          lastModified: validators?.lastModified ?? null,
        } : { etag: null, lastModified: null }).where(eq(ingestionSources.id, lease.id));
        const saved = finished[0]!;
        return { ...result, found: saved.found, inserted: saved.inserted, updated: saved.updated,
          unchanged: saved.unchanged, rejected: saved.rejected };
      }, { phase: "cleanup" });
    },
    async releaseSource(lease) {
      await inTransaction(async (transaction) => {
        await transaction.update(ingestionSources).set({ leaseToken: null, leaseExpiresAt: null })
          .where(and(eq(ingestionSources.id, lease.id), eq(ingestionSources.leaseToken, lease.token)));
      }, { phase: "cleanup" });
    },
  };
  return {
    db,
    store,
    async close() {
      await client.end({ timeout: DATABASE_POLICY.closeTimeoutSeconds });
    },
  };
}

export type { TrackInput };

