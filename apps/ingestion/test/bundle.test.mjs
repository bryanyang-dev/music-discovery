import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { test } from "node:test";

const require = createRequire(import.meta.url);
const bundle = require("../../../dist/ingestion/index.cjs");
test("built CommonJS artifact exports the Lambda handler without native or workspace dependencies", () => {
  assert.equal(typeof bundle.handler, "function");
});
test("bundled handler can fail safely before fetching when Lambda budget is exhausted", async () => {
  await assert.rejects(bundle.handler({}, { getRemainingTimeInMillis: () => 100 }), /RUN_DEADLINE/);
});

test("bundled handler rejects missing database configuration without fetching", async (context) => {
  const previousUrl = process.env.DATABASE_URL;
  process.env.DATABASE_URL = "";
  context.mock.method(globalThis, "fetch", async () => { assert.fail("must not fetch"); });
  try {
    await assert.rejects(bundle.handler({}, { getRemainingTimeInMillis: () => 300_000 }), /DATABASE_CONFIG_MISSING: DATABASE_URL is missing/);
  } finally {
    if (previousUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousUrl;
  }
});
