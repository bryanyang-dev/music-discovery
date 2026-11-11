import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
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

test("bundled handler fetches and parses RSS with a three-second Lambda budget and no database", async (context) => {
  const xml = await readFile(new URL("../../../packages/rss/test/fixtures/pitchfork.xml", import.meta.url), "utf8");
  context.mock.method(globalThis, "fetch", async () => new Response(xml));
  const logs = [];
  context.mock.method(console, "log", (message) => logs.push(message));

  const result = await bundle.handler({}, { getRemainingTimeInMillis: () => 3_000 });
  assert.equal(result.notModified, false);
  assert.ok(result.feed.entries.length > 0);
  assert.deepEqual(JSON.parse(logs.at(-1)).response, JSON.parse(JSON.stringify(result)));
});
