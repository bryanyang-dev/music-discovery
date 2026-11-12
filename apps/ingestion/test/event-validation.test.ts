import assert from "node:assert/strict";
import { test } from "node:test";
import { parseIngestionEvent } from "../src/event-validation.ts";
import type { IngestionEvent } from "../src/models.ts";

const validEvent = {
  sourceKey: "pitchfork_best_new_tracks",
} satisfies IngestionEvent;

test("valid payload returns the typed contract and ignores unrelated fields", () => {
  assert.deepEqual(
    parseIngestionEvent({ ...validEvent, unrelated: "ignored" }),
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
    { sourceKey: undefined },
    { sourceKey: null },
    { sourceKey: 123 },
    { sourceKey: "" },
    { sourceKey: "invalid value" },
    Object.create(validEvent),
    Object.assign([], validEvent),
  ]) {
    assert.throws(() => parseIngestionEvent(event), /INVALID_SOURCE/);
  }
});
