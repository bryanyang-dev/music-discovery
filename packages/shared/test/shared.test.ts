import assert from "node:assert/strict";
import { test } from "node:test";
import { httpUrl, pitchforkUrl, safeLogUrl, sourceKey, IngestionError, errorCode } from "../src/index.ts";

test("review identity drops fragments and tracking but preserves meaningful parameters", () => {
  assert.equal(pitchforkUrl("https://www.pitchfork.com/reviews/tracks/example/?utm_source=x&id=1#top"),
    "https://pitchfork.com/reviews/tracks/example/?id=1");
});
test("approved publisher URLs reject credential tricks, subdomains, ports and unsafe paths", () => {
  for (const url of [
    "file:///tmp/feed", "javascript:alert(1)", "https://user:password@pitchfork.com/reviews/x/",
    "https://pitchfork.com.evil.example/reviews/x/", "https://evil.pitchfork.com/reviews/x/",
    "https://pitchfork.com:444/reviews/x/", "http://pitchfork.com/reviews/x/",
    "https://pitchfork.com/reviews/best/tracks/", "https://pitchfork.com/reviews/%2fetc/",
  ]) assert.throws(() => pitchforkUrl(url));
});
test("feed URLs are pinned and query strings are not accepted", () => {
  assert.throws(() => pitchforkUrl("https://pitchfork.com/feed/rss", "feed"));
  assert.throws(() => pitchforkUrl("https://pitchfork.com/feed/reviews/best/tracks/rss?token=secret", "feed"));
});
test("logging removes query strings; errors never expose raw messages", () => {
  assert.equal(safeLogUrl("https://pitchfork.com/reviews/x/?token=secret"), "https://pitchfork.com/reviews/x/");
  assert.equal(safeLogUrl("https://user:secret@evil.example"), null);
  assert.equal(errorCode(new Error("password")), "DATABASE_ERROR");
  assert.equal(errorCode(new IngestionError("INVALID_FEED")), "INVALID_FEED");
});
test("identity hashes are deterministic and HTTP helper rejects credentials", () => {
  assert.equal(sourceKey("identity"), sourceKey("identity"));
  assert.equal(sourceKey("identity").length, 64);
  assert.throws(() => httpUrl("https://user:secret@example.com"));
});

