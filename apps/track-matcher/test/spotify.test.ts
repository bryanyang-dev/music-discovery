import assert from "node:assert/strict";
import { test } from "node:test";
import { searchSpotify } from "../src/spotify/search.ts";
import { SPOTIFY_HTTP_POLICY } from "../src/spotify/http.ts";

const track = { id: "00000000-0000-4000-8000-000000000001", trackTitle: "A Song", artists: ["An Artist"] };
const config = { clientId: "synthetic-client", clientSecret: "synthetic-secret-marker", market: "US" };
const recording = { id: "1234567890123456789012", name: "A Song", artists: [{ name: "An Artist" }] };
function mockFetch(responses: Response[]) {
  const calls: { url: string; init: RequestInit | undefined }[] = [];
  const fetcher = (async (url, init) => {
    calls.push({ url: String(url), init });
    const response = responses.shift();
    assert.ok(response, "unexpected HTTP request");
    return response;
  }) as typeof fetch;
  return { fetcher, calls };
}
const token = () => Response.json({ access_token: "synthetic-access-token" });
const page = (items: unknown[], next: string | null = null) => Response.json({ tracks: { items, next } });
const signal = () => AbortSignal.timeout(5_000);

test("client credentials and bounded catalog search return a canonical public URL", async () => {
  const mock = mockFetch([token(), page([{ ...recording, name: "  a SONG ", artists: [{ name: "AN ARTIST" }] }])]);
  const result = await searchSpotify(track, config, signal(), mock.fetcher);
  assert.equal(result.status, "matched");
  if (result.status === "matched") assert.equal(result.providerUrl, `https://open.spotify.com/track/${recording.id}`);
  assert.equal(mock.calls[0]?.url, "https://accounts.spotify.com/api/token");
  assert.equal(mock.calls[0]?.init?.body, "grant_type=client_credentials");
  assert.equal(new URL(mock.calls[1]!.url).searchParams.get("market"), "US");
  assert.equal(new URL(mock.calls[1]!.url).searchParams.get("limit"), "10");
  assert.ok(mock.calls.every(call => call.init?.redirect === "error" && call.init.signal));
});

test("all credited artists must match and alternate versions remain distinct", async () => {
  for (const candidate of [
    { ...recording, name: "A Song - Live" },
    { ...recording, artists: [{ name: "Another Artist" }] },
    { ...recording, artists: [...recording.artists, { name: "Guest" }] },
  ]) {
    const mock = mockFetch([token(), page([candidate])]);
    assert.deepEqual(await searchSpotify(track, config, signal(), mock.fetcher), { status: "not_found" });
  }
});

test("distinct exact results are ambiguous; duplicate provider IDs are deduplicated", async () => {
  for (const [id, status] of [["9876543210987654321098", "ambiguous"], [recording.id, "matched"]]) {
    const mock = mockFetch([token(), page([recording, { ...recording, id }])]);
    assert.equal((await searchSpotify(track, config, signal(), mock.fetcher)).status, status);
  }
});

test("later pages can establish ambiguity and untrusted next URLs are never fetched", async () => {
  const mock = mockFetch([token(), page([recording], "https://attacker.invalid/steal"),
    page([{ ...recording, id: "9876543210987654321098" }])]);
  assert.deepEqual(await searchSpotify(track, config, signal(), mock.fetcher), { status: "ambiguous" });
  assert.ok(mock.calls.slice(1).every(call => new URL(call.url).origin === "https://api.spotify.com"));
  assert.equal(new URL(mock.calls[2]!.url).searchParams.get("offset"), "10");
});

test("search cap does not establish a unique match or absence", async () => {
  const mock = mockFetch([token(), ...Array.from({ length: 5 }, () => page([], "more"))]);
  assert.deepEqual(await searchSpotify(track, config, signal(), mock.fetcher), { status: "ambiguous" });
  assert.equal(mock.calls.length, 6);
});

test("authentication, throttling, invalid JSON, malformed results and secrets fail safely", async () => {
  for (const [response, code] of [
    [new Response(config.clientSecret, { status: 401 }), "SPOTIFY_AUTH_ERROR"],
    [new Response(config.clientSecret, { status: 429 }), "SPOTIFY_RATE_LIMITED"],
    [new Response(config.clientSecret, { status: 503 }), "SPOTIFY_REQUEST_FAILED"],
    [new Response(config.clientSecret), "SPOTIFY_REQUEST_FAILED"],
    [page([{ ...recording, id: "bad-id" }]), "SPOTIFY_REQUEST_FAILED"],
    [Response.json({ tracks: { items: [] } }), "SPOTIFY_REQUEST_FAILED"],
  ] as const) {
    const mock = mockFetch([token(), response]);
    await assert.rejects(searchSpotify(track, config, signal(), mock.fetcher), error => {
      assert.match(String(error), new RegExp(code));
      assert.ok(!String(error).includes(config.clientSecret));
      return true;
    });
  }
});

test("oversized responses and invalid configuration fail without unbounded work", async () => {
  const oversized = mockFetch([token(), new Response("x".repeat(SPOTIFY_HTTP_POLICY.maxResponseBytes + 1))]);
  await assert.rejects(searchSpotify(track, config, signal(), oversized.fetcher), /RESPONSE_TOO_LARGE/);
  const unused = mockFetch([]);
  await assert.rejects(searchSpotify(track, { ...config, market: "" }, signal(), unused.fetcher), /SPOTIFY_CONFIG_INVALID/);
  assert.equal(unused.calls.length, 0);
});

test("network failure and cancellation never expose raw fetch errors", async () => {
  const fetcher = (async () => { throw new Error(config.clientSecret); }) as typeof fetch;
  await assert.rejects(searchSpotify(track, config, signal(), fetcher), /SPOTIFY_REQUEST_FAILED/);
  await assert.rejects(searchSpotify(track, config, AbortSignal.abort(), fetcher), /RUN_DEADLINE/);
});
