import assert from "node:assert/strict";
import { test } from "node:test";
import { describeTapeWeek } from "../src/listening-room/tape-week-labels.ts";

test("describes a tape week in every form the scene shows", () => {
  const { colorIndex: _colorIndex, ...labels } = describeTapeWeek("2026-11-09");
  assert.deepEqual(labels, {
    monthCode: "NOV",
    dayOfMonth: 9,
    tapeLabel: "WK 09 NOV",
    slotLabel: "09 NOV",
    spokenWeek: "week of 9 November 2026",
  });
});

test("consecutive weeks get different colours, cycling through seven", () => {
  const weeks = [
    "2026-11-02",
    "2026-11-09",
    "2026-11-16",
    "2026-11-23",
    "2026-11-30",
    "2026-12-07",
    "2026-12-14",
  ];
  const colors = weeks.map((week) => describeTapeWeek(week).colorIndex);
  assert.equal(new Set(colors).size, 7);
  assert.ok(colors.every((color) => color >= 0 && color < 7));
  assert.equal(
    describeTapeWeek("2026-12-21").colorIndex,
    describeTapeWeek("2026-11-02").colorIndex,
  );
});

test("rejects malformed dates, impossible dates and non-Mondays", () => {
  assert.throws(() => describeTapeWeek("9 Nov 2026"), /Invalid tape week/);
  assert.throws(() => describeTapeWeek("2026-02-30"), /Invalid tape week/);
  assert.throws(() => describeTapeWeek("2026-11-11"), /Invalid tape week/);
});
