import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { and, eq, sql } from "drizzle-orm";
import { IngestionError, PITCHFORK_FEED_URL, emptyCounts, type RunResult, type SourceLease, type TrackInput } from "@music-discovery/shared";
import { connectDatabase } from "../src/index.ts";
import { ingestionRuns, ingestionSources, tracks } from "../src/schema.ts";

const connectionString = process.env.TEST_DATABASE_URL;
const localTest = process.env.TEST_DATABASE_ALLOW_LOCAL_NO_TLS === "1";
const article: TrackInput = {
  sourceUrl: "https://pitchfork.com/reviews/tracks/integration-example/",
  sourceGuid: "test-guid", trackTitle: "Original", artists: ["Band & Guest"],
  reviewTitle: "Original", reviewAuthor: "Critic", reviewPublishedAt: new Date("2026-11-10T12:00:00Z"),
  summary: "Summary", imageUrl: null, genres: ["Pop"], labels: ["Example"], releaseDate: null,
};

async function fixture() {
  const database = connectDatabase(connectionString!, { localTest });
  const other = connectDatabase(connectionString!, { localTest });
  const keys = [randomUUID(), randomUUID()];
  const sources = await database.db.insert(ingestionSources).values(
    keys.map((key) => ({ key, feedUrl: PITCHFORK_FEED_URL })),
  ).returning();
  assert.equal(sources.length, 2);
  return {
    database, other, keys, sources,
    async cleanup() {
      try {
        for (const source of sources) {
          await database.db.delete(tracks).where(eq(tracks.sourceId, source.id));
          await database.db.delete(ingestionRuns).where(eq(ingestionRuns.sourceId, source.id));
          await database.db.delete(ingestionSources).where(eq(ingestionSources.id, source.id));
        }
      } finally { await Promise.all([database.close(), other.close()]); }
    },
  };
}
function successful(runId: string): RunResult {
  return { runId, status: "succeeded", ...emptyCounts(), inserted: 1, found: 1, errors: [], notModified: false };
}

test("Postgres upserts preserve IDs/first seen, classify changes, merge omissions and isolate sources", {
  skip: !connectionString,
}, async () => {
  const state = await fixture();
  try {
    const lease = await state.database.store.acquireSource(state.keys[0]!, 360);
    const second = await state.database.store.acquireSource(state.keys[1]!, 360);
    assert.ok(lease && second);
    const runId = await state.database.store.beginRun(lease);
    const secondRun = await state.database.store.beginRun(second);
    assert.equal(await state.database.store.upsertTrack(lease, runId, article), "inserted");
    const [before] = await state.database.db.select().from(tracks).where(eq(tracks.sourceId, lease.id));
    assert.ok(before);
    assert.equal(await state.database.store.upsertTrack(lease, runId, article), "unchanged");
    assert.equal(await state.database.store.upsertTrack(lease, runId, {
      ...article, trackTitle: "Updated", summary: null, reviewAuthor: null, genres: [], labels: [],
    }), "updated");
    assert.equal(await state.database.store.upsertTrack(second, secondRun, article), "inserted");
    const after = await state.database.db.select().from(tracks).where(eq(tracks.sourceId, lease.id));
    assert.equal(after.length, 1);
    assert.equal(after[0]?.id, before.id);
    assert.equal(after[0]?.firstSeenAt.getTime(), before.firstSeenAt.getTime());
    assert.equal(after[0]?.trackTitle, "Updated");
    assert.equal(after[0]?.summary, "Summary");
    assert.equal(after[0]?.reviewAuthor, "Critic");
    assert.deepEqual(after[0]?.genres, ["Pop"]);
    const [other] = await state.database.db.select().from(tracks).where(eq(tracks.sourceId, second.id));
    assert.equal(other?.trackTitle, "Original");
  } finally { await state.cleanup(); }
});
test("two clients cannot acquire the same source; expired tokens cannot write or release a successor", {
  skip: !connectionString,
}, async () => {
  const state = await fixture();
  try {
    const [first, concurrent] = await Promise.all([
      state.database.store.acquireSource(state.keys[0]!, 360),
      state.other.store.acquireSource(state.keys[0]!, 360),
    ]);
    const leases = [first, concurrent].filter((lease): lease is SourceLease => lease !== null);
    assert.equal(leases.length, 1);
    const old = leases[0]!;
    const oldRun = await state.database.store.beginRun(old);
    await state.database.store.recordDiscovery(old, oldRun, 1, []);
    assert.equal(await state.database.store.upsertTrack(old, oldRun, article), "inserted");
    await state.database.db.update(ingestionSources).set({
      leaseExpiresAt: sql`clock_timestamp() - interval '1 second'`, etag: '"stale"',
    }).where(eq(ingestionSources.id, old.id));
    const successor = await state.other.store.acquireSource(state.keys[0]!, 360);
    assert.ok(successor);
    assert.notEqual(successor.token, old.token);
    assert.equal(successor.etag, null);
    const [interrupted] = await state.database.db.select().from(ingestionRuns).where(eq(ingestionRuns.id, oldRun));
    assert.equal(interrupted?.status, "failed");
    assert.equal(interrupted?.errors[0]?.code, "INTERRUPTED_RUN");
    assert.equal(interrupted?.inserted, 1);
    assert.equal(interrupted?.found, 1);
    await assert.rejects(state.database.store.upsertTrack(old, oldRun, { ...article, trackTitle: "stale content" }),
      (error) => error instanceof IngestionError && error.code === "LEASE_LOST");
    await state.database.store.releaseSource(old);
    assert.equal(await state.database.store.acquireSource(state.keys[0]!, 360), null);
    const successorRun = await state.other.store.beginRun(successor);
    assert.equal(await state.other.store.upsertTrack(successor, successorRun, article), "unchanged");
    await assert.rejects(state.database.store.finishRun(old, successful(oldRun), { etag: '"wrong"', lastModified: null }));
    const [current] = await state.database.db.select().from(ingestionSources).where(eq(ingestionSources.id, old.id));
    assert.equal(current?.leaseToken, successor.token);
    assert.equal(current?.etag, null);
  } finally { await state.cleanup(); }
});
test("run finalization and successful validators are atomic; partial failure preserves last success", {
  skip: !connectionString,
}, async () => {
  const state = await fixture();
  try {
    const lease = await state.database.store.acquireSource(state.keys[0]!, 360);
    assert.ok(lease);
    const runId = await state.database.store.beginRun(lease);
    await state.database.store.recordDiscovery(lease, runId, 1, []);
    await state.database.store.upsertTrack(lease, runId, article);
    await state.database.store.finishRun(lease, successful(runId), { etag: '"good"', lastModified: "Tue, 10 Nov 2026 12:00:00 GMT" });
    const [success] = await state.database.db.select().from(ingestionSources).where(eq(ingestionSources.id, lease.id));
    assert.equal(success?.etag, '"good"');
    assert.ok(success?.lastSuccessAt);
    const partialRun = await state.database.store.beginRun(lease);
    await state.database.store.recordDiscovery(lease, partialRun, 1, []);
    await state.database.store.rejectEntry(lease, partialRun, { code: "MISSING_METADATA", sourceUrl: article.sourceUrl });
    await state.database.store.finishRun(lease, {
      ...successful(partialRun), status: "partial_failure", inserted: 0, rejected: 1,
      errors: [{ code: "MISSING_METADATA", sourceUrl: article.sourceUrl }],
    }, null);
    const [partial] = await state.database.db.select().from(ingestionSources).where(eq(ingestionSources.id, lease.id));
    assert.equal(partial?.etag, null);
    assert.equal(partial?.lastSuccessAt?.getTime(), success.lastSuccessAt.getTime());
    await assert.rejects(state.database.store.finishRun(lease, successful(randomUUID()), { etag: '"bad"', lastModified: null }));
    const [afterRollback] = await state.database.db.select().from(ingestionSources).where(eq(ingestionSources.id, lease.id));
    assert.equal(afterRollback?.etag, null);
    const [savedRun] = await state.database.db.select().from(ingestionRuns).where(eq(ingestionRuns.id, partialRun));
    assert.equal(savedRun?.status, "partial_failure");
    assert.equal(savedRun?.rejected, 1);
  } finally { await state.cleanup(); }
});
test("disabled sources do not acquire; direct duplicate source URLs violate uniqueness", {
  skip: !connectionString,
}, async () => {
  const state = await fixture();
  try {
    await state.database.db.update(ingestionSources).set({ enabled: false })
      .where(eq(ingestionSources.id, state.sources[0]!.id));
    assert.equal(await state.database.store.acquireSource(state.keys[0]!, 360), null);
    const lease = await state.database.store.acquireSource(state.keys[1]!, 360);
    assert.ok(lease);
    const runId = await state.database.store.beginRun(lease);
    await state.database.store.upsertTrack(lease, runId, article);
    await assert.rejects(state.database.db.insert(tracks).values({ ...article, sourceId: lease.id, metadataHash: "hash" }));
    assert.equal((await state.database.db.select().from(tracks).where(and(
      eq(tracks.sourceId, lease.id), eq(tracks.sourceUrl, article.sourceUrl),
    ))).length, 1);
  } finally { await state.cleanup(); }
});

