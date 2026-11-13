import assert from "node:assert/strict";
import { test } from "node:test";
import type { TapeTrack } from "../../../packages/shared/src/index.ts";
import { groupIntoWeeklyTapes, weekStartOf } from "../src/weekly-tapes.ts";

function track(
  id: string,
  recommendedAt: string,
  providerTrackId = `recording${id}`,
): TapeTrack {
  return {
    id,
    trackTitle: `Title ${id}`,
    artists: ["Artist", "Guest"],
    sourceUrl: `https://example.com/${id}`,
    recommendedAt: new Date(recommendedAt),
    providerTrackId,
  };
}

test("weeks start on Monday in UTC", () => {
  assert.equal(weekStartOf(new Date("2026-11-09T00:00:00Z")), "2026-11-09");
  assert.equal(weekStartOf(new Date("2026-11-15T23:59:59Z")), "2026-11-09");
  assert.equal(weekStartOf(new Date("2026-11-16T00:00:00Z")), "2026-11-16");
  // Crosses a month and year boundary.
  assert.equal(weekStartOf(new Date("2027-01-02T12:00:00Z")), "2026-12-28");
});

test("groups by week, newest week first, oldest track first within a week", () => {
  const tapes = groupIntoWeeklyTapes(
    [
      track("c", "2026-11-12T10:00:00Z"),
      track("a", "2026-11-03T10:00:00Z"),
      track("b", "2026-11-10T10:00:00Z"),
    ],
    7,
  );
  assert.deepEqual(
    tapes.map((tape) => [tape.weekStart, tape.tracks.map((item) => item.id)]),
    [
      ["2026-11-09", ["b", "c"]],
      ["2026-11-02", ["a"]],
    ],
  );
  assert.deepEqual(tapes[1]!.tracks[0], {
    id: "a",
    title: "Title a",
    artist: "Artist, Guest",
    spotifyUri: "spotify:track:recordinga",
    sourceUrl: "https://example.com/a",
    recommendedAt: "2026-11-03T10:00:00.000Z",
  });
});

test("keeps only the most recent weeks and skips weeks without tracks", () => {
  const tapes = groupIntoWeeklyTapes(
    [
      track("a", "2026-10-01T00:00:00Z"),
      track("b", "2026-11-10T00:00:00Z"),
      track("c", "2026-11-03T00:00:00Z"),
    ],
    2,
  );
  assert.deepEqual(
    tapes.map((tape) => tape.weekStart),
    ["2026-11-09", "2026-11-02"],
  );
});

test("a recording credited twice in a week appears once", () => {
  const [tape] = groupIntoWeeklyTapes(
    [
      track("a", "2026-11-10T00:00:00Z", "same"),
      track("b", "2026-11-11T00:00:00Z", "same"),
    ],
    7,
  );
  assert.deepEqual(
    tape!.tracks.map((item) => item.id),
    ["a"],
  );
});

test("no tracks means no tapes", () => {
  assert.deepEqual(groupIntoWeeklyTapes([], 7), []);
});
