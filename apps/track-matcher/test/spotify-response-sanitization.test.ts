import assert from "node:assert/strict";
import { test } from "node:test";
import {
  sanitizeSpotifyResponse,
  SPOTIFY_RESPONSE_LOG_LIMITS,
} from "../src/spotify/response-sanitization.ts";
import { spotifyJson, SPOTIFY_HTTP_POLICY } from "../src/spotify/http.ts";

const recording = {
  id: "1234567890123456789012",
  name: "Actual Song",
  artists: [{ id: "artist-id", name: "Actual Artist" }],
  album: {
    name: "Actual Album",
    images: [
      { url: "https://i.scdn.co/image/example", width: 300, height: 300 },
    ],
  },
  duration_ms: 123_000,
  explicit: false,
  external_ids: { isrc: "USABC1234567" },
};

test("catalog logs preserve actual public recording fields and pagination without mutating responses", () => {
  const input = {
    tracks: { items: [recording], next: null, total: 1, offset: 0, limit: 10 },
  };
  const original = structuredClone(input);
  assert.deepEqual(sanitizeSpotifyResponse(input, "search"), {
    response: input,
    responseTruncated: false,
  });
  assert.deepEqual(input, original);
});

test("token responses only expose safe expiry and type metadata", () => {
  const result = sanitizeSpotifyResponse(
    {
      access_token: "synthetic-token-marker",
      refresh_token: "synthetic-refresh-marker",
      name: "synthetic-unexpected-token-field-marker",
      token_type: "Bearer",
      expires_in: 3600,
    },
    "token",
  );
  assert.deepEqual(result, {
    response: { token_type: "Bearer", expires_in: 3600 },
    responseTruncated: false,
  });
});

test("nested secrets, unknown fields, error messages and URL credentials/query strings stay excluded", () => {
  const secret = "synthetic-response-secret-marker";
  const input = {
    tracks: {
      items: [
        {
          ...recording,
          access_token: secret,
          artists: [{ name: "Artist", client_secret: secret }],
          external_urls: {
            spotify: `https://open.spotify.com/track/example?token=${secret}#${secret}`,
          },
          href: `https://user:${secret}@api.spotify.com/v1/tracks/example`,
          preview_url: `https://cdn.example/audio?signature=${secret}`,
        },
      ],
      next: `https://api.spotify.com/v1/search?q=${secret}&offset=10`,
    },
    error: { status: 403, message: secret },
    [secret]: secret,
  };
  const { response } = sanitizeSpotifyResponse(input, "search") as {
    response: typeof input;
  };
  assert.equal(response.tracks.next, "https://api.spotify.com/v1/search");
  assert.equal(response.tracks.items[0]!.href, "[redacted]");
  assert.equal(
    response.tracks.items[0]!.preview_url,
    "https://cdn.example/audio",
  );
  assert.deepEqual(response.error, { status: 403 });
  assert.ok(!JSON.stringify(response).includes(secret));
  assert.deepEqual(
    sanitizeSpotifyResponse({ error: secret }, "search").response,
    { error: {} },
  );
  assert.deepEqual(
    sanitizeSpotifyResponse({ error: { status: secret } }, "search").response,
    { error: {} },
  );
});

test("array, string, depth and serialized byte limits mark truncation", () => {
  const limits = SPOTIFY_RESPONSE_LOG_LIMITS;
  const result = sanitizeSpotifyResponse(
    {
      tracks: {
        items: Array.from({ length: limits.maxArrayItems + 1 }, () => ({
          name: "x".repeat(limits.maxStringCharacters + 1),
        })),
      },
    },
    "search",
  );
  const output = result.response as { tracks: { items: { name: string }[] } };
  assert.equal(output.tracks.items.length, limits.maxArrayItems);
  assert.equal(output.tracks.items[0]!.name.length, limits.maxStringCharacters);
  assert.equal(result.responseTruncated, true);
  let nested: unknown = recording;
  for (let depth = 0; depth < limits.maxDepth + 2; depth++)
    nested = { album: nested };
  assert.equal(
    sanitizeSpotifyResponse(nested, "search").responseTruncated,
    true,
  );
  const large = {
    tracks: {
      items: Array.from({ length: limits.maxArrayItems }, () => ({
        artists: Array.from({ length: limits.maxArrayItems }, () => ({
          name: "é".repeat(limits.maxStringCharacters),
        })),
      })),
    },
  };
  const omitted = sanitizeSpotifyResponse(large, "search");
  assert.equal(omitted.response, "[response omitted: exceeds log size limit]");
  assert.equal(omitted.responseTruncated, true);
});

test("HTTP logs contain actual sanitized JSON on success and provider errors", async () => {
  for (const status of [200, 401, 429, 503]) {
    const messages: Record<string, unknown>[] = [];
    const payload =
      status === 200
        ? { tracks: { items: [recording] } }
        : { error: { status, message: "synthetic-error-secret-marker" } };
    const promise = spotifyJson(
      (async () => Response.json(payload, { status })) as typeof fetch,
      "https://api.spotify.com/v1/search",
      {},
      new AbortController().signal,
      {
        operation: "search",
        trackId: "track-id",
        logger: {
          log(message) {
            messages.push(JSON.parse(message));
          },
          error(message) {
            messages.push(JSON.parse(message));
          },
        },
      },
    );
    if (status === 200) assert.deepEqual(await promise, payload);
    else await assert.rejects(promise, /SPOTIFY_/);
    assert.equal(messages.length, 2);
    assert.deepEqual(
      messages[1]!.response,
      status === 200 ? payload : { error: { status } },
    );
    assert.ok(
      !JSON.stringify(messages).includes("synthetic-error-secret-marker"),
    );
  }
});

test("unreadable or oversized error bodies preserve the HTTP failure code", async () => {
  for (const body of [
    new Response("invalid-json", { status: 429 }),
    new Response("x".repeat(SPOTIFY_HTTP_POLICY.maxResponseBytes + 1), {
      status: 429,
    }),
    new Response(
      new ReadableStream({
        start(controller) {
          controller.error(new Error("synthetic-read-error-marker"));
        },
      }),
      { status: 429 },
    ),
  ]) {
    await assert.rejects(
      spotifyJson(
        (async () => body) as typeof fetch,
        "https://api.spotify.com/v1/search",
        {},
        new AbortController().signal,
        {
          operation: "search",
          trackId: "track-id",
          logger: { log() {}, error() {} },
        },
      ),
      /SPOTIFY_RATE_LIMITED/,
    );
  }
});
