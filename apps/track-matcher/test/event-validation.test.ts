import assert from "node:assert/strict";
import { test } from "node:test";
import { parseTrackMatcherEvent } from "../src/event-validation.ts";
import type { TrackMatcherEvent } from "../src/models.ts";

const validEvent = {
  trackId: "00000000-0000-4000-8000-000000000001",
} satisfies TrackMatcherEvent;

test("valid payload returns the typed contract and ignores unrelated fields", () => {
  assert.deepEqual(
    parseTrackMatcherEvent({ ...validEvent, unrelated: "ignored" }),
    validEvent,
  );
});

test("malformed payloads and inherited identifiers are rejected", () => {
  for (const event of [
    undefined,
    null,
    true,
    1,
    "payload",
    [],
    {},
    { trackId: undefined },
    { trackId: null },
    { trackId: 123 },
    { trackId: "" },
    { trackId: "invalid value" },
    Object.create(validEvent),
    Object.assign([], validEvent),
  ]) {
    assert.throws(() => parseTrackMatcherEvent(event), /INVALID_TRACK_ID/);
  }
});
