import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { fetchPitchforkFeed, parsePitchforkFeed } from "../src/index.ts";
import { HTTP_POLICY } from "../src/http-policy.ts";
import { plainText } from "../src/text.ts";

const feedUrl = "https://pitchfork.com/feed/reviews/best/tracks/rss";

const xml = await readFile(
  new URL("./fixtures/pitchfork.xml", import.meta.url),
  "utf8",
);

test("retry attempts, redirect count, and size limits retain the documented contract", () => {
  assert.equal(HTTP_POLICY.maxAttemptCount, 3);
  assert.equal(HTTP_POLICY.maxRedirectCount, 3);
  assert.equal(HTTP_POLICY.maxFeedResponseBytes, 2_000_000);
  assert.equal(HTTP_POLICY.maxReviewResponseBytes, 3_000_000);
});

test("cache validators accept the character limit and reject longer values", async () => {
  const expectedValidatorCharacters = 1_000;
  for (const characterCount of [
    expectedValidatorCharacters,
    expectedValidatorCharacters + 1,
  ]) {
    const etag = "x".repeat(characterCount);
    const result = await fetchPitchforkFeed(
      feedUrl,
      { etag: null, lastModified: null },
      {
        fetcher: async () => new Response(xml, { headers: { etag } }),
      },
    );
    const expected =
      characterCount === expectedValidatorCharacters ? etag : null;
    assert.equal(result.validators.etag, expected);
  }
});

test("feed entry limit accepts 100 entries and rejects 101", async () => {
  const item = xml.match(/<item>[\s\S]*?<\/item>/)![0];
  const emptyFeed = xml.replace(item, "");
  const atLimit = emptyFeed.replace(
    "</channel>",
    item.repeat(100) + "</channel>",
  );
  const beyondLimit = emptyFeed.replace(
    "</channel>",
    item.repeat(101) + "</channel>",
  );

  assert.equal((await parsePitchforkFeed(atLimit)).found, 100);
  await assert.rejects(parsePitchforkFeed(beyondLimit), /INVALID_FEED/);
});

test("plain-text metadata keeps the documented 4000-character bound", () => {
  assert.equal(plainText("x".repeat(4_001))?.length, 4_000);
});
