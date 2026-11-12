import assert from "node:assert/strict";
import { test } from "node:test";
import { createSampleWeek, sampleTracksPerTape, sampleWeekLengthDays } from "../src/floor-session/sample-mixtapes.ts";

test("builds one tape per day for the week ending today, newest first", () => {
  const tapes = createSampleWeek(new Date(2026, 10, 11, 15, 30));
  assert.equal(tapes.length, sampleWeekLengthDays);
  assert.deepEqual(
    tapes.map((tape) => tape.date),
    ["2026-11-11", "2026-11-10", "2026-11-09", "2026-11-08", "2026-11-07", "2026-11-06", "2026-11-05"],
  );
  for (const tape of tapes) {
    assert.equal(tape.tracks.length, sampleTracksPerTape);
  }
});

test("crosses month and year boundaries", () => {
  const tapes = createSampleWeek(new Date(2027, 0, 2));
  assert.equal(tapes[0]?.date, "2027-01-02");
  assert.equal(tapes[2]?.date, "2026-12-31");
  assert.equal(tapes[6]?.date, "2026-12-27");
});
