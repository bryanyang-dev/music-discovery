import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { previewSource } from "../src/preview.ts";

const xml = await readFile(new URL("../../../packages/rss/test/fixtures/pitchfork.xml", import.meta.url), "utf8");
const html = await readFile(new URL("../../../packages/rss/test/fixtures/review.html", import.meta.url), "utf8");

test("live previews read the source URL from storage without writing source/run/track data", async () => {
  const feedUrl = "https://pitchfork.com/feed/selected/tracks?edition=new";
  const requests: string[] = [];
  const result = await previewSource({
    async getSource(key) {
      assert.equal(key, "selected");
      return { key, id: "source", name: "pitchfork", category: "best_new_track", feedUrl,
        enabled: true, etag: '"old"', lastModified: "Tue, 10 Nov 2026 12:00:00 GMT" };
    },
  }, "selected", {
    fetcher: async (input, init) => {
      const url = String(input);
      requests.push(url);
      assert.equal(new Headers(init?.headers).has("If-None-Match"), false);
      assert.equal(new Headers(init?.headers).has("If-Modified-Since"), false);
      return new Response(url === feedUrl ? xml : html);
    },
  });
  assert.equal(result.status, "succeeded");
  if (result.status === "succeeded") {
    assert.equal(result.tracks.length, 1);
    assert.equal(result.tracks[0]?.trackTitle, "A Song: Part II");
  }
  assert.deepEqual(requests, [feedUrl, "https://pitchfork.com/reviews/tracks/example-a-song/"]);
});

test("disabled previews skip HTTP and invalid keys fail before source lookup", async () => {
  assert.deepEqual(await previewSource({ async getSource() { return null; } }, "disabled", {
    fetcher: async () => { assert.fail("disabled sources must not fetch"); },
  }), { status: "skipped", reason: "disabled" });
  await assert.rejects(previewSource({ async getSource() {
    assert.fail("invalid keys must not reach storage");
  } }, ""), /INVALID_SOURCE/);
});
