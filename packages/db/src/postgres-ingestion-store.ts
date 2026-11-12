import { and, eq, sql } from "drizzle-orm";
import { IngestionError, MAX_RUN_ERROR_COUNT, type IngestionStore, type SourceRecord } from "@music-discovery/shared";
import { ingestionRuns, ingestionSources, tracks, trackStreamingMatches } from "./schema.ts";
import { mergeTrack, metadataHash, sameTrackIdentity } from "./merge.ts";
import type { InTransaction, Transaction } from "./client.ts";
import type { QueryExecutor } from "./database-logging.ts";

export function createPostgresIngestionStore(inTransaction: InTransaction): IngestionStore {
  function activeRun(source: SourceRecord, runId: string) {
    return and(
      eq(ingestionRuns.id, runId),
      eq(ingestionRuns.sourceId, source.id),
      eq(ingestionRuns.status, "running"),
    );
  }

  async function requireRunUpdate(
    transaction: Transaction, query: QueryExecutor, source: SourceRecord, runId: string,
    patch: Partial<typeof ingestionRuns.$inferInsert>,
  ) {
    const saved = await query("update_run_issues", transaction.update(ingestionRuns).set(patch)
      .where(activeRun(source, runId)).returning({ id: ingestionRuns.id }));
    if (!saved.length) {
      throw new IngestionError("DATABASE_ERROR");
    }
  }

  return {
    async getSource(sourceKey) {
      return inTransaction("getSource", async (transaction, query) => {
        const [source] = await query("select_source", transaction.select().from(ingestionSources)
          .where(eq(ingestionSources.key, sourceKey)));
        if (!source) {
          throw new IngestionError("SOURCE_NOT_FOUND");
        }
        if (!source.enabled) {
          return null;
        }
        return { id: source.id, key: source.key, name: source.name, category: source.category, feedUrl: source.feedUrl, enabled: source.enabled,
          etag: source.etag, lastModified: source.lastModified };
      });
    },
    async beginRun(source) {
      return inTransaction("beginRun", async (transaction, query) => {
        // Clear persisted validators before work so a crash forces a full retry.
        // This run can still use the validators loaded by getSource.
        await query("record_source_attempt", transaction.update(ingestionSources).set({
          lastAttemptAt: sql`clock_timestamp()`, etag: null, lastModified: null,
        }).where(eq(ingestionSources.id, source.id)));
        const [run] = await query("insert_run", transaction.insert(ingestionRuns).values({ sourceId: source.id })
          .returning({ id: ingestionRuns.id }));
        if (!run) {
          throw new IngestionError("DATABASE_ERROR");
        }
        return run.id;
      });
    },
    async recordDiscovery(source, runId, errors) {
      await inTransaction("recordDiscovery", async (transaction, query) => {
        await requireRunUpdate(transaction, query, source, runId, {
          errors: errors.slice(0, MAX_RUN_ERROR_COUNT),
        });
      });
    },
    async rejectEntry(source, runId, issue) {
      await inTransaction("rejectEntry", async (transaction, query) => {
        const saved = await query("append_run_issue", transaction.update(ingestionRuns).set({
          errors: sql`CASE WHEN jsonb_array_length(${ingestionRuns.errors}) < ${MAX_RUN_ERROR_COUNT}
            THEN ${ingestionRuns.errors} || ${JSON.stringify([issue])}::jsonb ELSE ${ingestionRuns.errors} END`,
        }).where(activeRun(source, runId)).returning({ id: ingestionRuns.id }));
        if (!saved.length) {
          throw new IngestionError("DATABASE_ERROR");
        }
      });
    },
    async upsertTrack(source, runId, incoming) {
      if (!incoming.trackTitle.trim() || !incoming.artists.length || incoming.artists.some((artist) => !artist.trim())) {
        throw new IngestionError("INVALID_ENTRY");
      }
      return inTransaction("upsertTrack", async (transaction, query) => {
        const [run] = await query("lock_active_run", transaction.select({ id: ingestionRuns.id }).from(ingestionRuns)
          .where(activeRun(source, runId)).for("update"));
        if (!run) {
          throw new IngestionError("DATABASE_ERROR");
        }
        const [previous] = await query("select_existing_track", transaction.select().from(tracks)
          .where(and(eq(tracks.sourceId, source.id), eq(tracks.sourceUrl, incoming.sourceUrl))).for("update"));
        const merged = mergeTrack(incoming, previous);
        const hash = metadataHash(merged);
        if (previous?.metadataHash === hash) {
          await query("refresh_track_last_seen", transaction.update(tracks)
            .set({ lastSeenAt: sql`clock_timestamp()` }).where(eq(tracks.id, previous.id)));
          return "unchanged";
        }
        if (previous && !sameTrackIdentity(previous, merged)) {
          await query("invalidate_streaming_matches", transaction.delete(trackStreamingMatches)
            .where(eq(trackStreamingMatches.trackId, previous.id)));
        }
        await query("upsert_track", transaction.insert(tracks).values({ ...merged, sourceId: source.id, metadataHash: hash })
          .onConflictDoUpdate({
            target: [tracks.sourceId, tracks.sourceUrl],
            set: { ...merged, metadataHash: hash, lastSeenAt: sql`clock_timestamp()`, updatedAt: sql`clock_timestamp()` },
          }));
        const outcome = previous ? "updated" : "inserted";
        return outcome;
      });
    },
    async finishRun(source, result, validators) {
      return inTransaction("finishRun", async (transaction, query) => {
        const finished = await query("finalize_run", transaction.update(ingestionRuns).set({
          status: result.status,
          finishedAt: sql`clock_timestamp()`,
          notModified: result.notModified,
          errors: result.errors.slice(0, MAX_RUN_ERROR_COUNT),
        }).where(activeRun(source, result.runId)).returning());
        if (!finished.length) {
          throw new IngestionError("DATABASE_ERROR");
        }
        await query("finalize_source", transaction.update(ingestionSources).set(result.status === "succeeded" ? {
          lastSuccessAt: sql`clock_timestamp()`, etag: validators?.etag ?? null,
          lastModified: validators?.lastModified ?? null,
        } : { etag: null, lastModified: null }).where(eq(ingestionSources.id, source.id)));
        return result;
      }, { phase: "cleanup" });
    },
  };
}
