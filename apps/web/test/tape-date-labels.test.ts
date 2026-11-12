import assert from "node:assert/strict";
import { test } from "node:test";
import { describeTapeDate } from "../src/listening-room/tape-date-labels.ts";

test("describes a tape date in every form the scene shows", () => {
  assert.deepEqual(describeTapeDate("2026-11-11"), {
    weekdayIndex: 3,
    weekdayCode: "WED",
    weekdayKanji: "水",
    weekdayJapanese: "水曜日",
    monthCode: "NOV",
    dayOfMonth: 11,
    tapeLabel: "WED 11 NOV",
    slotLabel: "WED 11",
    spokenDate: "Wednesday 11 November",
  });
});

test("pads single-digit days on labels but not in the spoken date", () => {
  const labels = describeTapeDate("2026-11-09");
  assert.equal(labels.tapeLabel, "MON 09 NOV");
  assert.equal(labels.slotLabel, "MON 09");
  assert.equal(labels.spokenDate, "Monday 9 November");
});

test("rejects malformed and impossible dates", () => {
  assert.throws(() => describeTapeDate("11 Nov 2026"), /Invalid tape date/);
  assert.throws(() => describeTapeDate("2026-02-30"), /Invalid tape date/);
  assert.throws(() => describeTapeDate("2026-13-01"), /Invalid tape date/);
});
