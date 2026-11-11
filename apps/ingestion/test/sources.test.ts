import assert from "node:assert/strict";
import { test } from "node:test";
import { IngestionError, type SourceDefinition } from "@music-discovery/shared";
import { getSourceAdapter } from "@music-discovery/rss";
import { sourceKeyFromEvent } from "../src/handler.ts";
import { addIngestionSource, parseSourceArgs } from "../src/source-registration.ts";

const feedUrl = "https://pitchfork.com/feed/reviews/best/tracks/rss";

const args = ["--key", "another_pitchfork_feed", "--name", "pitchfork", "--category", "best_new_track", "--feed-url", feedUrl];

test("events must explicitly select a registered source key", () => {
  assert.equal(sourceKeyFromEvent({ sourceKey: "another_feed" }), "another_feed");
  for (const event of [undefined, {}, { source: "music-discovery.scheduler" }, null, [], "feed",
    { sourceKey: null }, { sourceKey: "" }, { sourceKey: "https://evil.example/" }]) {
    assert.throws(() => sourceKeyFromEvent(event), /INVALID_SOURCE/);
  }
});

test("registration validates arguments and adapter compatibility before connecting", async () => {
  const source = parseSourceArgs(args);
  assert.equal(source.key, "another_pitchfork_feed");
  assert.equal(source.feedUrl, feedUrl);
  for (const invalid of [[], [...args, "--unknown", "x"], [...args, "--key", "duplicate"], args.slice(0, -1),
    args.map(value => value === "pitchfork" ? "unknown" : value),
    args.map(value => value === feedUrl ? "https://127.0.0.1/feed/" : value)]) {
    await assert.rejects(addIngestionSource(invalid, "unused", () => {
      assert.fail("invalid input must not connect");
    }));
  }
  await assert.rejects(addIngestionSource(args, undefined), /DATABASE_CONFIG_MISSING/);
});

test("registration writes only source configuration and always closes the connection", async () => {
  let closed = 0;
  const registered: SourceDefinition[] = [];
  const key = await addIngestionSource(args, "private", (url, options) => {
    assert.equal(url, "private");
    assert.equal(options.sourceKey, "another_pitchfork_feed");
    return {
      sources: { async addSource(source) { registered.push(source); } },
      async close() { closed++; },
    };
  });
  assert.equal(key, "another_pitchfork_feed");
  assert.deepEqual(registered, [parseSourceArgs(args)]);
  assert.equal(closed, 1);
});

test("registration preserves its primary failure when closing also fails", async () => {
  const failure = new IngestionError("SOURCE_ALREADY_EXISTS");
  await assert.rejects(addIngestionSource(args, "unused", () => ({
    sources: { async addSource() { throw failure; } },
    async close() { throw new Error("private cleanup details"); },
  })), error => error === failure);
  await assert.rejects(addIngestionSource(args, "unused", () => ({
    sources: { async addSource() {} },
    async close() { throw new IngestionError("DATABASE_TIMEOUT"); },
  })), /DATABASE_TIMEOUT/);
});

test("unsupported names, categories and feed URLs cannot fall back to Pitchfork", () => {
  const source = parseSourceArgs(args);
  for (const invalid of [{ ...source, name: "other" }, { ...source, category: "album" },
    { ...source, feedUrl: "https://evil.example/feed/" }]) {
    assert.throws(() => getSourceAdapter(invalid));
  }
});
