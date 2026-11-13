import assert from "node:assert/strict";
import { test } from "node:test";
import { IngestionError } from "../../../packages/shared/src/index.ts";
import { matchPendingTracks } from "../src/pending-track-matching.ts";

test("counts each outcome and continues after a failed track", async () => {
  const attempted: string[] = [];
  const outcomes: Record<string, () => Promise<{ status: string }>> = {
    a: async () => ({ status: "matched" }),
    b: async () => {
      throw new IngestionError("SPOTIFY_RATE_LIMITED");
    },
    c: async () => ({ status: "not_found" }),
    d: async () => ({ status: "ambiguous" }),
  };
  const summary = await matchPendingTracks(["a", "b", "c", "d"], (trackId) => {
    attempted.push(trackId);
    return outcomes[trackId]!();
  });
  assert.deepEqual(attempted, ["a", "b", "c", "d"]);
  assert.deepEqual(summary, {
    matched: 1,
    notFound: 1,
    ambiguous: 1,
    failed: [{ trackId: "b", code: "SPOTIFY_RATE_LIMITED" }],
  });
});

test("an empty list makes no calls", async () => {
  const summary = await matchPendingTracks([], async () => {
    throw new Error("unexpected call");
  });
  assert.deepEqual(summary, {
    matched: 0,
    notFound: 0,
    ambiguous: 0,
    failed: [],
  });
});
