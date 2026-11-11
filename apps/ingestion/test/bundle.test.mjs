import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { test } from "node:test";

const require = createRequire(import.meta.url);
const bundle = require("../../../dist/ingestion/index.cjs");
test("built CommonJS artifact exports the Lambda handler without native or workspace dependencies", () => {
  assert.equal(typeof bundle.handler, "function");
});
test("bundled handler can fail safely before connecting when Lambda budget is exhausted", async () => {
  await assert.rejects(bundle.handler({}, { getRemainingTimeInMillis: () => 100 }), /RUN_DEADLINE/);
});

