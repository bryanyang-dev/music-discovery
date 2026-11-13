import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createMixtapeSession,
  reduceMixtapeSession,
} from "../src/listening-room/mixtape-session.ts";
import type { Mixtape } from "../src/listening-room/models.ts";
import {
  planSkip,
  planTogglePlayback,
} from "../src/listening-room/tape-playback.ts";

const tape: Mixtape = {
  date: "2026-11-09",
  tracks: ["a", "b", "c"].map((id) => ({
    id,
    title: id,
    artist: "Artist",
    spotifyUri: `spotify:track:${id}`,
    sourceUrl: `https://example.com/${id}`,
  })),
};

test("play starts the tape from the selected track when Spotify is elsewhere", () => {
  const session = reduceMixtapeSession(createMixtapeSession([tape]), {
    type: "nextTrack",
  });
  for (const current of [null, "spotify:track:other"]) {
    assert.deepEqual(planTogglePlayback(session, current), {
      kind: "start",
      uris: ["spotify:track:a", "spotify:track:b", "spotify:track:c"],
      offset: 1,
    });
  }
});

test("play toggles when Spotify is already on this tape", () => {
  const session = createMixtapeSession([tape]);
  assert.deepEqual(planTogglePlayback(session, "spotify:track:c"), {
    kind: "toggle",
  });
});

test("skips go to Spotify only when it is on this tape", () => {
  const session = createMixtapeSession([tape]);
  assert.deepEqual(planSkip(session, "spotify:track:b", "next"), {
    kind: "next",
  });
  assert.deepEqual(planSkip(session, "spotify:track:b", "previous"), {
    kind: "previous",
  });
  assert.deepEqual(planSkip(session, "spotify:track:other", "next"), {
    kind: "none",
  });
  assert.deepEqual(planSkip(session, null, "next"), { kind: "none" });
});

test("nothing is sent with no tape loaded", () => {
  const empty = reduceMixtapeSession(createMixtapeSession([tape]), {
    type: "ejectTape",
  });
  assert.deepEqual(planTogglePlayback(empty, null), { kind: "none" });
});
