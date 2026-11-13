import assert from "node:assert/strict";
import { test } from "node:test";
import { drizzle } from "drizzle-orm/postgres-js";
import { createPostgresTrackMatchingStore } from "../src/postgres-track-matching-store.ts";
import { createPostgresIngestionStore } from "../src/postgres-ingestion-store.ts";
import type { InTransaction, Transaction } from "../src/client.ts";
import type { QueryExecutor } from "../src/database-logging.ts";
import type { TrackInput, SourceRecord } from "@music-discovery/shared";

const track = {
  id: "00000000-0000-4000-8000-000000000001",
  trackTitle: "A Song",
  artists: ["An Artist"],
};
function fixture(responses: Record<string, unknown> = {}) {
  const calls: { operation: string; sql: string; params: unknown[] }[] = [];
  const db = drizzle.mock();
  const query = (async (operation: string, statement: unknown) => {
    const built = (
      statement as { toSQL(): { sql: string; params: unknown[] } }
    ).toSQL();
    calls.push({ operation, ...built });
    return responses[operation] ?? [];
  }) as QueryExecutor;
  const inTransaction: InTransaction = async (_operation, work) =>
    work(db as unknown as Transaction, query);
  return {
    store: createPostgresTrackMatchingStore(inTransaction),
    ingestion: createPostgresIngestionStore(inTransaction),
    calls,
  };
}

test("stale or deleted track cannot receive lookup results or error diagnostics", async () => {
  for (const current of [
    null,
    { ...track, trackTitle: "Changed" },
    { ...track, artists: ["Changed"] },
  ]) {
    const state = fixture({ lock_matching_track: current ? [current] : [] });
    await assert.rejects(
      state.store.saveMatch(track, { status: "not_found" }),
      current ? /TRACK_CHANGED/ : /TRACK_NOT_FOUND/,
    );
    await assert.rejects(
      state.store.recordFailure(track, "SPOTIFY_RATE_LIMITED"),
      current ? /TRACK_CHANGED/ : /TRACK_NOT_FOUND/,
    );
    assert.ok(
      state.calls.every((call) => call.operation === "lock_matching_track"),
    );
    assert.ok(state.calls.every((call) => call.sql.includes("for update")));
  }
});

test("failure upsert updates diagnostics without replacing established recording fields", async () => {
  const state = fixture({ lock_matching_track: [track] });
  await state.store.recordFailure(track, "SPOTIFY_RATE_LIMITED");
  const call = state.calls.find(
    (call) => call.operation === "record_spotify_failure",
  )!;
  const update = call.sql.split("do update set")[1]!;
  assert.match(update, /last_error_code/);
  assert.doesNotMatch(
    update,
    /match_status|provider_track_id|provider_url|matched_at|match_method/,
  );
  assert.ok(call.params.includes("pending"));
  assert.ok(call.params.includes("SPOTIFY_RATE_LIMITED"));
});

test("confirmed and manual matches survive repeated automatic lookup and are returned truthfully", async () => {
  const state = fixture({
    lock_matching_track: [track],
    select_existing_spotify_match: [
      {
        matchStatus: "matched",
        providerTrackId: "1234567890123456789012",
        providerUrl: "https://open.spotify.com/track/1234567890123456789012",
        providerTitle: "Saved",
        providerArtists: ["Saved artist"],
        matchMethod: "manual",
      },
    ],
  });
  const saved = await state.store.saveMatch(track, { status: "not_found" });
  assert.equal(saved.status, "matched");
  assert.ok(
    !state.calls.some((call) => call.operation === "upsert_spotify_match"),
  );
  const refresh = state.calls.find(
    (call) => call.operation === "refresh_spotify_attempt",
  )!;
  assert.doesNotMatch(
    refresh.sql.split(" where ")[0]!,
    /provider_title|match_status|match_method/,
  );
});

test("unresolved lookup writes no recording and successful lookup clears error diagnostics", async () => {
  for (const status of ["not_found", "ambiguous"] as const) {
    const state = fixture({ lock_matching_track: [track] });
    assert.deepEqual(await state.store.saveMatch(track, { status }), {
      status,
    });
    const call = state.calls.find(
      (call) => call.operation === "upsert_spotify_match",
    )!;
    assert.ok(call.params.includes(status));
    assert.match(call.sql, /"provider_track_id" = \$\d+/);
    assert.match(call.sql, /"last_error_code" = \$\d+/);
    assert.ok(call.params.filter((param) => param === null).length >= 10);
  }
});

const article: TrackInput = {
  sourceUrl: "https://pitchfork.com/reviews/tracks/example/",
  sourceGuid: null,
  trackTitle: track.trackTitle,
  artists: track.artists,
  reviewTitle: null,
  reviewAuthor: null,
  reviewPublishedAt: null,
  summary: null,
  imageUrl: null,
  genres: [],
  labels: [],
  releaseDate: null,
};
const source: SourceRecord = {
  id: track.id,
  key: "test",
  name: "pitchfork",
  category: "best_new_track",
  feedUrl: "https://pitchfork.com/feed/reviews/best/tracks/rss",
  enabled: true,
  etag: null,
  lastModified: null,
};

test("ingestion invalidates provider matches only when title or credited artists change", async () => {
  for (const patch of [
    { summary: "New review" },
    { trackTitle: "New title" },
    { artists: ["New artist"] },
  ]) {
    const state = fixture({
      lock_active_run: [{ id: track.id }],
      select_existing_track: [
        { ...article, id: track.id, metadataHash: "outdated" },
      ],
    });
    await state.ingestion.upsertTrack(source, track.id, {
      ...article,
      ...patch,
    });
    const invalidated = state.calls.find(
      (call) => call.operation === "invalidate_streaming_matches",
    );
    assert.equal(
      Boolean(invalidated),
      "trackTitle" in patch || "artists" in patch,
    );
    const select = state.calls.find(
      (call) => call.operation === "select_existing_track",
    )!;
    assert.match(select.sql, /for update/);
    if (invalidated) {
      assert.match(invalidated.sql, /^delete from "track_streaming_matches"/);
      assert.doesNotMatch(invalidated.sql, /"provider"/);
      assert.ok(
        state.calls.indexOf(invalidated) <
          state.calls.findIndex((call) => call.operation === "upsert_track"),
      );
    }
  }
});

test("existing manual attribution stays nullable rather than inventing provider metadata", async () => {
  const state = fixture({
    lock_matching_track: [track],
    select_existing_spotify_match: [
      {
        matchStatus: "matched",
        providerTrackId: "1234567890123456789012",
        providerUrl: "https://open.spotify.com/track/1234567890123456789012",
        providerTitle: null,
        providerArtists: null,
        matchMethod: "manual",
      },
    ],
  });
  const saved = await state.store.saveMatch(track, { status: "not_found" });
  assert.equal(saved.status, "matched");
  if (saved.status === "matched") {
    assert.equal(saved.providerTitle, null);
    assert.equal(saved.providerArtists, null);
  }
});

test("lists unattempted and pending tracks, oldest first, within the limit", async () => {
  const state = fixture({
    select_tracks_to_match: [{ id: track.id }],
  });
  assert.deepEqual(await state.store.listTrackIdsToMatch(25), [track.id]);
  const [call] = state.calls;
  assert.equal(call?.operation, "select_tracks_to_match");
  assert.match(call!.sql, /left join "track_streaming_matches"/);
  assert.match(
    call!.sql,
    /"track_streaming_matches"\."track_id" is null or "track_streaming_matches"\."match_status" = \$\d/,
  );
  assert.match(call!.sql, /order by "tracks"\."first_seen_at" asc/);
  assert.ok(call!.params.includes("pending"));
  assert.ok(call!.params.includes(25));
});
