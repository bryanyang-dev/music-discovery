import assert from "node:assert/strict";
import { test } from "node:test";
import {
  fetchSpotifyClientId,
  fetchTapes,
  parseTapesResponse,
  TapeLoadError,
} from "../src/listening-room/tape-api.ts";

const validTrack = {
  id: "track-1",
  title: "Song",
  artist: "Artist",
  spotifyUri: "spotify:track:0123456789abcdefghijkl",
  sourceUrl: "https://pitchfork.com/reviews/tracks/song/",
  recommendedAt: "2026-11-10T00:00:00.000Z",
};

function jsonFetch(status: number, body: unknown): typeof fetch {
  return (async () =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    })) as typeof fetch;
}

test("maps API weeks to tapes", () => {
  assert.deepEqual(
    parseTapesResponse({
      tapes: [{ weekStart: "2026-11-09", tracks: [validTrack] }],
    }),
    [
      {
        date: "2026-11-09",
        tracks: [
          {
            id: "track-1",
            title: "Song",
            artist: "Artist",
            spotifyUri: "spotify:track:0123456789abcdefghijkl",
            sourceUrl: "https://pitchfork.com/reviews/tracks/song/",
          },
        ],
      },
    ],
  );
});

test("rejects malformed tapes and tracks", () => {
  for (const body of [
    null,
    { tapes: "no" },
    { tapes: [{ weekStart: "Nov 9", tracks: [validTrack] }] },
    { tapes: [{ weekStart: "2026-11-09", tracks: [] }] },
    {
      tapes: [
        {
          weekStart: "2026-11-09",
          tracks: [{ ...validTrack, spotifyUri: "x" }],
        },
      ],
    },
    {
      tapes: [
        {
          weekStart: "2026-11-09",
          tracks: [{ ...validTrack, sourceUrl: "javascript:x" }],
        },
      ],
    },
  ]) {
    assert.throws(() => parseTapesResponse(body), TapeLoadError);
  }
});

test("surfaces the API's safe error code", async () => {
  await assert.rejects(
    fetchTapes(jsonFetch(500, { code: "DATABASE_TIMEOUT" })),
    (error: unknown) =>
      error instanceof TapeLoadError && error.code === "DATABASE_TIMEOUT",
  );
});

test("reports an unreachable API", async () => {
  const failing = (async () => {
    throw new TypeError("fetch failed");
  }) as typeof fetch;
  await assert.rejects(
    fetchTapes(failing),
    (error: unknown) =>
      error instanceof TapeLoadError && error.code === "API_UNREACHABLE",
  );
});

test("reads the Spotify client ID", async () => {
  assert.equal(
    await fetchSpotifyClientId(jsonFetch(200, { clientId: "abc" })),
    "abc",
  );
});
