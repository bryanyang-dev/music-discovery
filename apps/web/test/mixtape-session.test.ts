import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createMixtapeSession,
  findLoadedTape,
  reduceMixtapeSession,
  type MixtapeSession,
  type MixtapeSessionAction,
} from "../src/floor-session/mixtape-session.ts";
import type { Mixtape } from "../src/floor-session/models.ts";

const tapes: Mixtape[] = [
  {
    date: "2026-11-11",
    tracks: [
      { title: "One", artist: "A" },
      { title: "Two", artist: "B" },
      { title: "Three", artist: "C" },
    ],
  },
  { date: "2026-11-10", tracks: [{ title: "Only", artist: "D" }] },
];

function run(session: MixtapeSession, ...actions: MixtapeSessionAction[]): MixtapeSession {
  return actions.reduce(reduceMixtapeSession, session);
}

test("starts with the newest tape loaded and stopped", () => {
  const session = createMixtapeSession(tapes);
  assert.equal(session.loadedTapeDate, "2026-11-11");
  assert.equal(session.trackIndex, 0);
  assert.equal(session.playing, false);
  assert.equal(findLoadedTape(session), tapes[0]);
});

test("starts empty when there are no tapes", () => {
  const session = createMixtapeSession([]);
  assert.equal(session.loadedTapeDate, null);
  assert.equal(findLoadedTape(session), null);
});

test("play toggles, stop always stops and keeps the track", () => {
  const playing = run(createMixtapeSession(tapes), { type: "nextTrack" }, { type: "togglePlayback" });
  assert.equal(playing.playing, true);
  assert.equal(run(playing, { type: "togglePlayback" }).playing, false);

  const stopped = run(playing, { type: "stop" });
  assert.equal(stopped.playing, false);
  assert.equal(stopped.trackIndex, 1);
});

test("track changes stay within the tape", () => {
  const start = createMixtapeSession(tapes);
  assert.equal(run(start, { type: "previousTrack" }), start);

  const end = run(start, { type: "nextTrack" }, { type: "nextTrack" }, { type: "nextTrack" }, { type: "nextTrack" });
  assert.equal(end.trackIndex, 2);
  assert.equal(run(end, { type: "previousTrack" }).trackIndex, 1);
});

test("loading another tape rewinds and stops", () => {
  const playing = run(createMixtapeSession(tapes), { type: "nextTrack" }, { type: "togglePlayback" });
  const swapped = run(playing, { type: "loadTape", date: "2026-11-10" });
  assert.equal(swapped.loadedTapeDate, "2026-11-10");
  assert.equal(swapped.trackIndex, 0);
  assert.equal(swapped.playing, false);
});

test("loading the current or an unknown tape changes nothing", () => {
  const playing = run(createMixtapeSession(tapes), { type: "togglePlayback" });
  assert.equal(run(playing, { type: "loadTape", date: "2026-11-11" }), playing);
  assert.equal(run(playing, { type: "loadTape", date: "1999-01-01" }), playing);
});

test("ejecting empties the player and disables transport", () => {
  const playing = run(createMixtapeSession(tapes), { type: "nextTrack" }, { type: "togglePlayback" });
  const empty = run(playing, { type: "ejectTape" });
  assert.equal(empty.loadedTapeDate, null);
  assert.equal(empty.playing, false);
  assert.equal(empty.trackIndex, 0);

  assert.equal(run(empty, { type: "togglePlayback" }), empty);
  assert.equal(run(empty, { type: "nextTrack" }), empty);
  assert.equal(run(empty, { type: "ejectTape" }), empty);
});
