import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { and, eq } from "drizzle-orm";
import {
  IngestionError,
  emptyCounts,
  type RunResult,
  type TrackInput,
} from "@music-discovery/shared";
import { connectDatabase, type DatabaseLogger } from "../src/index.ts";
import {
  ingestionRuns,
  ingestionSources,
  tracks,
  trackStreamingMatches,
} from "../src/schema.ts";

const connectionString = process.env.TEST_DATABASE_URL;
const localTest = process.env.TEST_DATABASE_ALLOW_LOCAL_NO_TLS === "1";
const article: TrackInput = {
  sourceUrl: "https://pitchfork.com/reviews/tracks/integration-example/",
  sourceGuid: "test-guid",
  trackTitle: "Original",
  artists: ["Band & Guest"],
  reviewTitle: "Original",
  reviewAuthor: "Critic",
  reviewPublishedAt: new Date("2026-11-10T12:00:00Z"),
  summary: "Summary",
  imageUrl: null,
  genres: ["Pop"],
  labels: ["Example"],
  releaseDate: null,
};

async function fixture(logger?: DatabaseLogger) {
  const database = connectDatabase(connectionString!, {
    localTest,
    ...(logger ? { logger, requestId: "integration-request" } : {}),
  });
  const other = connectDatabase(connectionString!, { localTest });
  const keys = [randomUUID(), randomUUID()];
  const sources = await database.db
    .insert(ingestionSources)
    .values(
      keys.map((key) => ({ key, feedUrl: "https://example.com/feed.xml" })),
    )
    .returning();
  assert.equal(sources.length, 2);
  return {
    database,
    other,
    keys,
    sources,
    async cleanup() {
      try {
        for (const source of sources) {
          const sourceTracks = await database.db
            .select({ id: tracks.id })
            .from(tracks)
            .where(eq(tracks.sourceId, source.id));
          for (const track of sourceTracks) {
            await database.db
              .delete(trackStreamingMatches)
              .where(eq(trackStreamingMatches.trackId, track.id));
          }
          await database.db
            .delete(tracks)
            .where(eq(tracks.sourceId, source.id));
          await database.db
            .delete(ingestionRuns)
            .where(eq(ingestionRuns.sourceId, source.id));
          await database.db
            .delete(ingestionSources)
            .where(eq(ingestionSources.id, source.id));
        }
      } finally {
        await Promise.all([database.close(), other.close()]);
      }
    },
  };
}
function successful(runId: string): RunResult {
  return {
    runId,
    status: "succeeded",
    ...emptyCounts(),
    inserted: 1,
    found: 1,
    errors: [],
    notModified: false,
  };
}

test(
  "streaming matches allow multiple providers and shared recordings across editorial tracks",
  {
    skip: !connectionString,
  },
  async () => {
    const state = await fixture();
    try {
      const savedTracks = await state.database.db
        .insert(tracks)
        .values(
          state.sources.map((source) => ({
            ...article,
            sourceId: source.id,
            metadataHash: "streaming-test",
          })),
        )
        .returning();
      const first = savedTracks[0]!;
      const second = savedTracks[1]!;
      const matched = {
        matchStatus: "matched" as const,
        providerTrackId: "shared-recording",
        providerUrl: "https://open.spotify.com/track/example",
        matchMethod: "manual" as const,
        matchedAt: new Date(),
      };
      await state.database.db.insert(trackStreamingMatches).values([
        { trackId: first.id, provider: "spotify", ...matched },
        { trackId: first.id, provider: "soundcloud" },
        { trackId: second.id, provider: "spotify", ...matched },
      ]);
      const rows = await state.database.db
        .select()
        .from(trackStreamingMatches)
        .where(eq(trackStreamingMatches.trackId, first.id));
      assert.equal(rows.length, 2);
      assert.equal(
        rows.find((row) => row.provider === "soundcloud")?.matchStatus,
        "pending",
      );
      await assert.rejects(
        state.database.db
          .insert(trackStreamingMatches)
          .values({ trackId: first.id, provider: "spotify" }),
      );
      await assert.rejects(
        state.database.db
          .insert(trackStreamingMatches)
          .values({ trackId: randomUUID(), provider: "spotify" }),
      );
      await state.database.db
        .update(trackStreamingMatches)
        .set({ lastAttemptAt: new Date(), lastErrorCode: "RATE_LIMITED" })
        .where(
          and(
            eq(trackStreamingMatches.trackId, first.id),
            eq(trackStreamingMatches.provider, "spotify"),
          ),
        );
      const [afterError] = await state.database.db
        .select()
        .from(trackStreamingMatches)
        .where(
          and(
            eq(trackStreamingMatches.trackId, first.id),
            eq(trackStreamingMatches.provider, "spotify"),
          ),
        );
      assert.equal(afterError?.matchStatus, "matched");
      assert.equal(afterError?.providerTrackId, matched.providerTrackId);
    } finally {
      await state.cleanup();
    }
  },
);

test(
  "streaming constraints reject incomplete matches, invalid states, and unconfirmed recording data",
  {
    skip: !connectionString,
  },
  async () => {
    const state = await fixture();
    try {
      const [track] = await state.database.db
        .insert(tracks)
        .values({
          ...article,
          sourceId: state.sources[0]!.id,
          metadataHash: "streaming-test",
        })
        .returning();
      assert.ok(track);
      type MatchInsert = typeof trackStreamingMatches.$inferInsert;
      const base = { trackId: track.id, provider: "spotify" };
      const complete = {
        ...base,
        matchStatus: "matched" as const,
        providerTrackId: "recording",
        providerUrl: "https://open.spotify.com/track/example",
        matchMethod: "search" as const,
        matchedAt: new Date(),
      };
      const invalid: MatchInsert[] = [
        { ...base, provider: " " },
        { ...base, provider: "Spotify" },
        { ...base, matchStatus: "invalid" as never },
        { ...complete, matchMethod: "invalid" as never },
        { ...base, matchStatus: "matched" },
        { ...complete, providerTrackId: null },
        { ...complete, providerTrackId: " " },
        { ...complete, providerUrl: null },
        { ...complete, providerUrl: " " },
        { ...complete, matchMethod: null },
        { ...complete, matchedAt: null },
        { ...base, providerTrackId: "unconfirmed" },
        { ...base, matchStatus: "ambiguous", providerTitle: "Candidate" },
        {
          ...base,
          matchStatus: "not_found",
          uploaderName: "Unconfirmed uploader",
        },
        { ...base, matchedAt: new Date() },
      ];
      for (const row of invalid) {
        await assert.rejects(
          state.database.db.insert(trackStreamingMatches).values(row),
        );
      }
      for (const matchStatus of [
        "pending",
        "not_found",
        "ambiguous",
      ] as const) {
        await state.database.db
          .insert(trackStreamingMatches)
          .values({ ...base, matchStatus });
        await state.database.db
          .delete(trackStreamingMatches)
          .where(eq(trackStreamingMatches.trackId, track.id));
      }
      await state.database.db.insert(trackStreamingMatches).values(complete);
    } finally {
      await state.cleanup();
    }
  },
);

test(
  "database API logs transactions, each SQL statement and shutdown with sanitized row data",
  {
    skip: !connectionString,
  },
  async () => {
    const records: Record<string, unknown>[] = [];
    const capture = (message: string) => {
      records.push(JSON.parse(message));
    };
    const state = await fixture({ log: capture, error: capture });
    try {
      const source = await state.database.store.getSource(state.keys[0]!);
      assert.ok(source);
      const runId = await state.database.store.beginRun(source);
      await state.database.store.recordDiscovery(source, runId, []);
      await state.database.store.upsertTrack(source, runId, {
        ...article,
        summary: "logged-track-summary",
      });
      await state.database.store.upsertTrack(source, runId, {
        ...article,
        summary: "logged-track-summary",
      });
      await state.database.store.rejectEntry(source, runId, {
        code: "INVALID_ENTRY",
        sourceUrl: null,
      });
      await state.database.store.finishRun(source, successful(runId), null);
      await assert.rejects(
        state.database.store.getSource("missing_source"),
        /SOURCE_NOT_FOUND/,
      );
    } finally {
      await state.cleanup();
    }
    const requests = records.filter(
      (record) => record.event === "database_request",
    );
    const responses = records.filter(
      (record) => record.event === "database_response",
    );
    assert.equal(requests.length, responses.length);
    for (const request of requests) {
      assert.equal(
        responses.filter((response) => response.callId === request.callId)
          .length,
        1,
      );
      assert.equal(request.requestId, "integration-request");
    }
    const queries = requests.filter((record) => record.scope === "query");
    for (const operation of [
      "select_source",
      "record_source_attempt",
      "insert_run",
      "update_run_issues",
      "lock_active_run",
      "select_existing_track",
      "upsert_track",
      "refresh_track_last_seen",
      "append_run_issue",
      "finalize_run",
      "finalize_source",
      "set_statement_timeout",
      "set_lock_timeout",
    ]) {
      assert.ok(
        queries.some((record) => record.operation === operation),
        operation,
      );
    }
    for (const query of queries) {
      assert.ok(
        requests.some(
          (record) =>
            record.callId === query.parentCallId &&
            record.scope === "transaction",
        ),
      );
    }
    assert.ok(responses.some((record) => record.code === "SOURCE_NOT_FOUND"));
    assert.ok(
      responses.some(
        (record) =>
          record.operation === "close" && record.status === "succeeded",
      ),
    );
    assert.match(JSON.stringify(records), /logged-track-summary/);
    assert.doesNotMatch(
      JSON.stringify(records),
      /INSERT INTO|SELECT |postgres:\/\//,
    );
  },
);

test(
  "source registration is insert-only and rejects duplicate keys",
  {
    skip: !connectionString,
  },
  async () => {
    const state = await fixture();
    const key = randomUUID().replaceAll("-", "");
    const definition = {
      key: `test_${key}`,
      name: "pitchfork",
      category: "best_new_track",
      feedUrl: "https://example.com/feed.xml",
    };
    try {
      await state.database.sources.addSource(definition);
      const source = await state.database.store.getSource(definition.key);
      assert.ok(source);
      assert.equal(source.name, definition.name);
      assert.equal(source.category, definition.category);
      assert.equal(source.feedUrl, definition.feedUrl);
      await assert.rejects(
        state.database.sources.addSource({ ...definition, name: "other" }),
        /SOURCE_ALREADY_EXISTS/,
      );
      assert.equal(
        (await state.database.store.getSource(definition.key))?.name,
        definition.name,
      );
    } finally {
      await state.database.db
        .delete(ingestionSources)
        .where(eq(ingestionSources.key, definition.key));
      await state.cleanup();
    }
  },
);

test(
  "Postgres upserts preserve IDs/first seen, classify changes, merge omissions and isolate sources",
  {
    skip: !connectionString,
  },
  async () => {
    const state = await fixture();
    try {
      const source = await state.database.store.getSource(state.keys[0]!);
      const second = await state.database.store.getSource(state.keys[1]!);
      assert.ok(source && second);
      const runId = await state.database.store.beginRun(source);
      const secondRun = await state.database.store.beginRun(second);
      await assert.rejects(
        state.database.store.upsertTrack(second, runId, article),
      );
      assert.equal(
        await state.database.store.upsertTrack(source, runId, article),
        "inserted",
      );
      const [before] = await state.database.db
        .select()
        .from(tracks)
        .where(eq(tracks.sourceId, source.id));
      assert.ok(before);
      assert.equal(
        await state.database.store.upsertTrack(source, runId, article),
        "unchanged",
      );
      assert.equal(
        await state.database.store.upsertTrack(source, runId, {
          ...article,
          trackTitle: "Updated",
          summary: null,
          reviewAuthor: null,
          genres: [],
          labels: [],
        }),
        "updated",
      );
      assert.equal(
        await state.database.store.upsertTrack(second, secondRun, article),
        "inserted",
      );
      const after = await state.database.db
        .select()
        .from(tracks)
        .where(eq(tracks.sourceId, source.id));
      assert.equal(after.length, 1);
      assert.equal(after[0]?.id, before.id);
      assert.equal(
        after[0]?.firstSeenAt.getTime(),
        before.firstSeenAt.getTime(),
      );
      assert.equal(after[0]?.trackTitle, "Updated");
      assert.equal(after[0]?.summary, "Summary");
      assert.equal(after[0]?.reviewAuthor, "Critic");
      assert.deepEqual(after[0]?.genres, ["Pop"]);
      const [other] = await state.database.db
        .select()
        .from(tracks)
        .where(eq(tracks.sourceId, second.id));
      assert.equal(other?.trackTitle, "Original");
    } finally {
      await state.cleanup();
    }
  },
);
test(
  "two workers can start independent runs for the same source without taking ownership",
  {
    skip: !connectionString,
  },
  async () => {
    const state = await fixture();
    try {
      await state.database.db
        .update(ingestionSources)
        .set({ etag: '"old"' })
        .where(eq(ingestionSources.id, state.sources[0]!.id));
      const source = await state.database.store.getSource(state.keys[0]!);
      assert.ok(source);
      const firstRun = await state.database.store.beginRun(source);
      const second = await state.other.store.getSource(state.keys[0]!);
      assert.ok(second);
      assert.equal(second.etag, null);
      const secondRun = await state.other.store.beginRun(second);
      assert.notEqual(firstRun, secondRun);
      const [first] = await state.database.db
        .select()
        .from(ingestionRuns)
        .where(eq(ingestionRuns.id, firstRun));
      assert.equal(first?.status, "running");
      assert.equal(
        await state.database.store.upsertTrack(source, firstRun, article),
        "inserted",
      );
      assert.equal(
        await state.other.store.upsertTrack(second, secondRun, article),
        "unchanged",
      );
      await state.database.store.finishRun(source, successful(firstRun), null);
      await state.other.store.finishRun(second, successful(secondRun), null);
    } finally {
      await state.cleanup();
    }
  },
);
test(
  "run finalization and successful validators are atomic; partial failure preserves last success",
  {
    skip: !connectionString,
  },
  async () => {
    const state = await fixture();
    try {
      const source = await state.database.store.getSource(state.keys[0]!);
      assert.ok(source);
      const runId = await state.database.store.beginRun(source);
      await state.database.store.recordDiscovery(source, runId, []);
      await state.database.store.upsertTrack(source, runId, article);
      await state.database.store.finishRun(source, successful(runId), {
        etag: '"good"',
        lastModified: "Tue, 10 Nov 2026 12:00:00 GMT",
      });
      const [success] = await state.database.db
        .select()
        .from(ingestionSources)
        .where(eq(ingestionSources.id, source.id));
      assert.equal(success?.etag, '"good"');
      assert.ok(success?.lastSuccessAt);
      const partialRun = await state.database.store.beginRun(source);
      await state.database.store.recordDiscovery(source, partialRun, []);
      await state.database.store.rejectEntry(source, partialRun, {
        code: "MISSING_METADATA",
        sourceUrl: article.sourceUrl,
      });
      await state.database.store.finishRun(
        source,
        {
          ...successful(partialRun),
          status: "partial_failure",
          inserted: 0,
          rejected: 1,
          errors: [{ code: "MISSING_METADATA", sourceUrl: article.sourceUrl }],
        },
        null,
      );
      const [partial] = await state.database.db
        .select()
        .from(ingestionSources)
        .where(eq(ingestionSources.id, source.id));
      assert.equal(partial?.etag, null);
      assert.equal(
        partial?.lastSuccessAt?.getTime(),
        success.lastSuccessAt.getTime(),
      );
      await assert.rejects(
        state.database.store.finishRun(source, successful(randomUUID()), {
          etag: '"bad"',
          lastModified: null,
        }),
      );
      const [afterRollback] = await state.database.db
        .select()
        .from(ingestionSources)
        .where(eq(ingestionSources.id, source.id));
      assert.equal(afterRollback?.etag, null);
      const [savedRun] = await state.database.db
        .select()
        .from(ingestionRuns)
        .where(eq(ingestionRuns.id, partialRun));
      assert.equal(savedRun?.status, "partial_failure");
      assert.equal(savedRun?.errors[0]?.code, "MISSING_METADATA");
      await assert.rejects(
        state.database.store.upsertTrack(source, partialRun, article),
      );
      await assert.rejects(
        state.database.store.rejectEntry(source, partialRun, {
          code: "INVALID_ENTRY",
          sourceUrl: null,
        }),
      );
    } finally {
      await state.cleanup();
    }
  },
);
test(
  "disabled sources are skipped; direct duplicate source URLs violate uniqueness",
  {
    skip: !connectionString,
  },
  async () => {
    const state = await fixture();
    try {
      await state.database.db
        .update(ingestionSources)
        .set({ enabled: false })
        .where(eq(ingestionSources.id, state.sources[0]!.id));
      assert.equal(await state.database.store.getSource(state.keys[0]!), null);
      await assert.rejects(
        state.database.store.getSource("missing-source"),
        (error) =>
          error instanceof IngestionError && error.code === "SOURCE_NOT_FOUND",
      );
      const source = await state.database.store.getSource(state.keys[1]!);
      assert.ok(source);
      const runId = await state.database.store.beginRun(source);
      await state.database.store.upsertTrack(source, runId, article);
      await assert.rejects(
        state.database.db
          .insert(tracks)
          .values({ ...article, sourceId: source.id, metadataHash: "hash" }),
      );
      assert.equal(
        (
          await state.database.db
            .select()
            .from(tracks)
            .where(
              and(
                eq(tracks.sourceId, source.id),
                eq(tracks.sourceUrl, article.sourceUrl),
              ),
            )
        ).length,
        1,
      );
    } finally {
      await state.cleanup();
    }
  },
);

test(
  "Spotify matches persist independently, survive provider errors, and invalidate on identity edits",
  { skip: !connectionString },
  async () => {
    const state = await fixture();
    try {
      const source = await state.database.store.getSource(state.keys[0]!);
      assert.ok(source);
      const runId = await state.database.store.beginRun(source);
      await state.database.store.upsertTrack(source, runId, article);
      const [row] = await state.database.db
        .select()
        .from(tracks)
        .where(eq(tracks.sourceId, source.id));
      assert.ok(row);
      const target = await state.database.matching.getTrack(row.id);
      assert.ok(target);
      const match = {
        status: "matched" as const,
        providerTrackId: "1234567890123456789012",
        providerUrl: "https://open.spotify.com/track/1234567890123456789012",
        providerTitle: article.trackTitle,
        providerArtists: article.artists,
      };
      await state.database.matching.saveMatch(target, match);
      await state.database.matching.recordFailure(
        target,
        "SPOTIFY_RATE_LIMITED",
      );
      const [failed] = await state.database.db
        .select()
        .from(trackStreamingMatches)
        .where(eq(trackStreamingMatches.trackId, row.id));
      assert.equal(failed?.matchStatus, "matched");
      assert.equal(failed?.providerUrl, match.providerUrl);
      assert.equal(failed?.lastErrorCode, "SPOTIFY_RATE_LIMITED");
      assert.deepEqual(
        await state.database.matching.saveMatch(target, {
          status: "not_found",
        }),
        match,
      );
      await state.database.store.upsertTrack(source, runId, {
        ...article,
        summary: "New review summary",
      });
      assert.equal(
        (
          await state.database.db
            .select()
            .from(trackStreamingMatches)
            .where(eq(trackStreamingMatches.trackId, row.id))
        ).length,
        1,
      );
      await state.database.store.upsertTrack(source, runId, {
        ...article,
        trackTitle: "Changed title",
      });
      assert.equal(
        (
          await state.database.db
            .select()
            .from(trackStreamingMatches)
            .where(eq(trackStreamingMatches.trackId, row.id))
        ).length,
        0,
      );
      await assert.rejects(
        state.database.matching.saveMatch(target, match),
        /TRACK_CHANGED/,
      );
    } finally {
      await state.cleanup();
    }
  },
);
