import assert from "node:assert/strict";
import { test } from "node:test";
import { pitchforkUrl } from "../src/publishers/pitchfork/urls.ts";

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
test("configured feed paths and query parameters retain publisher safety rules", () => {
  assert.equal(pitchforkUrl("https://pitchfork.com/feed/custom/tracks?category=new", "feed"),
    "https://pitchfork.com/feed/custom/tracks?category=new");
  for (const url of ["https://evil.example/feed/custom", "https://127.0.0.1/feed/custom",
    "https://pitchfork.com/reviews/tracks/example/"]) {
    assert.throws(() => pitchforkUrl(url, "feed"));
  }
});
