import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { and, eq } from "drizzle-orm";
import { IngestionError, PITCHFORK_FEED_URL, emptyCounts, type RunResult, type TrackInput } from "@music-discovery/shared";
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
    const source = await state.database.store.getSource(state.keys[0]!);
    const second = await state.database.store.getSource(state.keys[1]!);
    assert.ok(source && second);
    const runId = await state.database.store.beginRun(source);
    const secondRun = await state.database.store.beginRun(second);
    await assert.rejects(state.database.store.upsertTrack(second, runId, article));
    assert.equal(await state.database.store.upsertTrack(source, runId, article), "inserted");
    const [before] = await state.database.db.select().from(tracks).where(eq(tracks.sourceId, source.id));
    assert.ok(before);
    assert.equal(await state.database.store.upsertTrack(source, runId, article), "unchanged");
    assert.equal(await state.database.store.upsertTrack(source, runId, {
      ...article, trackTitle: "Updated", summary: null, reviewAuthor: null, genres: [], labels: [],
    }), "updated");
    assert.equal(await state.database.store.upsertTrack(second, secondRun, article), "inserted");
    const after = await state.database.db.select().from(tracks).where(eq(tracks.sourceId, source.id));
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
test("two workers can start independent runs for the same source without taking ownership", {
  skip: !connectionString,
}, async () => {
  const state = await fixture();
  try {
    await state.database.db.update(ingestionSources).set({ etag: '"old"' })
      .where(eq(ingestionSources.id, state.sources[0]!.id));
    const source = await state.database.store.getSource(state.keys[0]!);
    assert.ok(source);
    const firstRun = await state.database.store.beginRun(source);
    const second = await state.other.store.getSource(state.keys[0]!);
    assert.ok(second);
    assert.equal(second.etag, null);
    const secondRun = await state.other.store.beginRun(second);
    assert.notEqual(firstRun, secondRun);
    const [first] = await state.database.db.select().from(ingestionRuns)
      .where(eq(ingestionRuns.id, firstRun));
    assert.equal(first?.status, "running");
    assert.equal(await state.database.store.upsertTrack(source, firstRun, article), "inserted");
    assert.equal(await state.other.store.upsertTrack(second, secondRun, article), "unchanged");
    await state.database.store.finishRun(source, successful(firstRun), null);
    await state.other.store.finishRun(second, successful(secondRun), null);
  } finally { await state.cleanup(); }
});
test("run finalization and successful validators are atomic; partial failure preserves last success", {
  skip: !connectionString,
}, async () => {
  const state = await fixture();
  try {
    const source = await state.database.store.getSource(state.keys[0]!);
    assert.ok(source);
    const runId = await state.database.store.beginRun(source);
    await state.database.store.recordDiscovery(source, runId, []);
    await state.database.store.upsertTrack(source, runId, article);
    await state.database.store.finishRun(source, successful(runId), { etag: '"good"', lastModified: "Tue, 10 Nov 2026 12:00:00 GMT" });
    const [success] = await state.database.db.select().from(ingestionSources).where(eq(ingestionSources.id, source.id));
    assert.equal(success?.etag, '"good"');
    assert.ok(success?.lastSuccessAt);
    const partialRun = await state.database.store.beginRun(source);
    await state.database.store.recordDiscovery(source, partialRun, []);
    await state.database.store.rejectEntry(source, partialRun, { code: "MISSING_METADATA", sourceUrl: article.sourceUrl });
    await state.database.store.finishRun(source, {
      ...successful(partialRun), status: "partial_failure", inserted: 0, rejected: 1,
      errors: [{ code: "MISSING_METADATA", sourceUrl: article.sourceUrl }],
    }, null);
    const [partial] = await state.database.db.select().from(ingestionSources).where(eq(ingestionSources.id, source.id));
    assert.equal(partial?.etag, null);
    assert.equal(partial?.lastSuccessAt?.getTime(), success.lastSuccessAt.getTime());
    await assert.rejects(state.database.store.finishRun(source, successful(randomUUID()), { etag: '"bad"', lastModified: null }));
    const [afterRollback] = await state.database.db.select().from(ingestionSources).where(eq(ingestionSources.id, source.id));
    assert.equal(afterRollback?.etag, null);
    const [savedRun] = await state.database.db.select().from(ingestionRuns).where(eq(ingestionRuns.id, partialRun));
    assert.equal(savedRun?.status, "partial_failure");
    assert.equal(savedRun?.errors[0]?.code, "MISSING_METADATA");
    await assert.rejects(state.database.store.upsertTrack(source, partialRun, article));
    await assert.rejects(state.database.store.rejectEntry(source, partialRun, { code: "INVALID_ENTRY", sourceUrl: null }));
  } finally { await state.cleanup(); }
});
test("disabled sources are skipped; direct duplicate source URLs violate uniqueness", {
  skip: !connectionString,
}, async () => {
  const state = await fixture();
  try {
    await state.database.db.update(ingestionSources).set({ enabled: false })
      .where(eq(ingestionSources.id, state.sources[0]!.id));
    assert.equal(await state.database.store.getSource(state.keys[0]!), null);
    await assert.rejects(state.database.store.getSource("missing-source"),
      (error) => error instanceof IngestionError && error.code === "SOURCE_NOT_FOUND");
    const source = await state.database.store.getSource(state.keys[1]!);
    assert.ok(source);
    const runId = await state.database.store.beginRun(source);
    await state.database.store.upsertTrack(source, runId, article);
    await assert.rejects(state.database.db.insert(tracks).values({ ...article, sourceId: source.id, metadataHash: "hash" }));
    assert.equal((await state.database.db.select().from(tracks).where(and(
      eq(tracks.sourceId, source.id), eq(tracks.sourceUrl, article.sourceUrl),
    ))).length, 1);
  } finally { await state.cleanup(); }
});

