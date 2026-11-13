import assert from "node:assert/strict";
import { test } from "node:test";
import { drizzle } from "drizzle-orm/postgres-js";
import { createPostgresTapeStore } from "../src/postgres-tape-store.ts";
import type { InTransaction, Transaction } from "../src/client.ts";
import type { QueryExecutor } from "../src/database-logging.ts";

function fixture(rows: unknown[]) {
  const calls: { operation: string; sql: string; params: unknown[] }[] = [];
  const db = drizzle.mock();
  const query = (async (operation: string, statement: unknown) => {
    const built = (
      statement as { toSQL(): { sql: string; params: unknown[] } }
    ).toSQL();
    calls.push({ operation, ...built });
    return rows;
  }) as QueryExecutor;
  const inTransaction: InTransaction = async (_operation, work) =>
    work(db as unknown as Transaction, query);
  return { store: createPostgresTapeStore(inTransaction), calls };
}

const reviewed = new Date("2026-11-10T00:00:00Z");
const firstSeen = new Date("2026-11-12T00:00:00Z");

test("reads only matched Spotify recordings, newest recommendation first", async () => {
  const state = fixture([]);
  await state.store.listMatchedTracks(50);
  const [call] = state.calls;
  assert.equal(call?.operation, "select_matched_tracks");
  assert.match(call!.sql, /inner join "track_streaming_matches"/);
  assert.match(
    call!.sql,
    /order by coalesce\("tracks"\."review_published_at", "tracks"\."first_seen_at"\) desc/,
  );
  assert.ok(call!.params.includes("spotify"));
  assert.ok(call!.params.includes("matched"));
  assert.ok(call!.params.includes(50));
});

test("uses first-seen time when the review date is missing", async () => {
  const state = fixture([
    {
      id: "a",
      trackTitle: "Song",
      artists: ["Artist"],
      sourceUrl: "https://example.com/a",
      reviewPublishedAt: reviewed,
      firstSeenAt: firstSeen,
      providerTrackId: "abc",
    },
    {
      id: "b",
      trackTitle: "Other",
      artists: ["Artist"],
      sourceUrl: "https://example.com/b",
      reviewPublishedAt: null,
      firstSeenAt: firstSeen,
      providerTrackId: "def",
    },
  ]);
  const tracks = await state.store.listMatchedTracks(50);
  assert.deepEqual(
    tracks.map((item) => [item.id, item.recommendedAt]),
    [
      ["a", reviewed],
      ["b", firstSeen],
    ],
  );
});

test("skips rows without a recording ID", async () => {
  const state = fixture([
    {
      id: "a",
      trackTitle: "Song",
      artists: ["Artist"],
      sourceUrl: "https://example.com/a",
      reviewPublishedAt: reviewed,
      firstSeenAt: firstSeen,
      providerTrackId: null,
    },
  ]);
  assert.deepEqual(await state.store.listMatchedTracks(50), []);
});
