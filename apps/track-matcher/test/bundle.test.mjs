import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { test } from "node:test";
const require = createRequire(import.meta.url);
const { handler } = require("../../../dist/track-matcher/index.cjs");

test("matcher artifact exports handler and rejects invalid events before database access", async () => {
  assert.equal(typeof handler, "function");
  await assert.rejects(handler({}), /INVALID_TRACK_ID/);
});

test("matcher artifact fails safely with insufficient Lambda budget", async () => {
  await assert.rejects(
    handler(
      { trackId: "00000000-0000-4000-8000-000000000001" },
      { getRemainingTimeInMillis: () => 1 },
    ),
    /RUN_DEADLINE/,
  );
});
