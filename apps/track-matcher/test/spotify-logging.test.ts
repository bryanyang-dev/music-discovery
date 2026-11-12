import assert from "node:assert/strict";
import { test } from "node:test";
import { spotifyJson, SPOTIFY_HTTP_POLICY } from "../src/spotify/http.ts";
import { searchSpotify } from "../src/spotify/search.ts";

function capture() {
  const events: Record<string, unknown>[] = [];
  const levels: string[] = [];
  return {
    events,
    levels,
    logger: {
      log(message: string) {
        levels.push("INFO");
        events.push(JSON.parse(message));
      },
      error(message: string) {
        levels.push("ERROR");
        events.push(JSON.parse(message));
      },
    },
  };
}

function assertPair(events: Record<string, unknown>[], status: string) {
  assert.equal(events.length, 2);
  const [request, response] = events;
  assert.equal(request!.event, "spotify_request");
  assert.equal(response!.event, "spotify_response");
  assert.equal(response!.callId, request!.callId);
  assert.equal(typeof request!.callId, "string");
  assert.equal(response!.status, status);
  assert.ok(Number(response!.durationMs) >= 0);
}

test("every token request and search page has a correlated log pair with sanitized responses", async () => {
  const state = capture();
  const clientId = "synthetic-client-id-marker";
  const clientSecret = "synthetic-client-secret-marker";
  const accessToken = "synthetic-access-token-marker";
  const bodyMarker = "synthetic-response-body-marker";
  const responses = [
    Response.json({ access_token: accessToken }),
    Response.json({ tracks: { items: [], next: bodyMarker } }),
    Response.json({ tracks: { items: [], next: null } }),
  ];
  const result = await searchSpotify(
    {
      id: "track-id",
      trackTitle: "synthetic-query-marker",
      artists: ["Artist"],
    },
    { clientId, clientSecret, market: "US" },
    new AbortController().signal,
    (async () => responses.shift()!) as typeof fetch,
    { logger: state.logger, requestId: "request-id" },
  );
  assert.deepEqual(result, { status: "not_found" });
  assert.equal(state.events.length, 6);
  for (let index = 0; index < state.events.length; index += 2) {
    const pair = state.events.slice(index, index + 2);
    assertPair(pair, "succeeded");
    for (const entry of pair) {
      assert.equal(entry.requestId, "request-id");
      assert.equal(entry.trackId, "track-id");
      assert.equal(entry.operation, index === 0 ? "token" : "search");
      if (index > 0) assert.equal(entry.offset, (index / 2 - 1) * 10);
    }
    assert.equal(pair[1]!.httpStatus, 200);
  }
  assert.equal(new Set(state.events.map((event) => event.callId)).size, 3);
  const serialized = JSON.stringify(state.events);
  for (const marker of [
    clientId,
    clientSecret,
    accessToken,
    bodyMarker,
    Buffer.from(`${clientId}:${clientSecret}`).toString("base64"),
  ]) {
    assert.ok(!serialized.includes(marker));
  }
});

test("HTTP, network, JSON, body read, size and cancellation failures emit one safe terminal event", async () => {
  const secret = "synthetic-raw-error-marker";
  const cases: {
    fetcher: typeof fetch;
    signal?: AbortSignal;
    code: string;
    httpStatus: number | null;
  }[] = [
    ...([401, 403, 429, 503] as const).map((status) => ({
      fetcher: (async () => new Response(secret, { status })) as typeof fetch,
      code:
        status === 429
          ? "SPOTIFY_RATE_LIMITED"
          : status === 503
            ? "SPOTIFY_REQUEST_FAILED"
            : "SPOTIFY_AUTH_ERROR",
      httpStatus: status,
    })),
    {
      fetcher: (async () => {
        throw new Error(secret);
      }) as typeof fetch,
      code: "SPOTIFY_REQUEST_FAILED",
      httpStatus: null,
    },
    {
      fetcher: (async () => new Response(secret)) as typeof fetch,
      code: "SPOTIFY_REQUEST_FAILED",
      httpStatus: 200,
    },
    {
      fetcher: (async () =>
        new Response(
          new ReadableStream({
            start(controller) {
              controller.error(new Error(secret));
            },
          }),
        )) as typeof fetch,
      code: "SPOTIFY_REQUEST_FAILED",
      httpStatus: 200,
    },
    {
      fetcher: (async () =>
        new Response(
          "x".repeat(SPOTIFY_HTTP_POLICY.maxResponseBytes + 1),
        )) as typeof fetch,
      code: "RESPONSE_TOO_LARGE",
      httpStatus: 200,
    },
    {
      fetcher: (async (_url, init) => {
        init!.signal!.throwIfAborted();
        throw new Error(secret);
      }) as typeof fetch,
      signal: AbortSignal.abort(new Error(secret)),
      code: "RUN_DEADLINE",
      httpStatus: null,
    },
    {
      fetcher: (async () => {
        throw new DOMException(secret, "TimeoutError");
      }) as typeof fetch,
      code: "SPOTIFY_REQUEST_FAILED",
      httpStatus: null,
    },
  ];
  for (const entry of cases) {
    const state = capture();
    await assert.rejects(
      spotifyJson(
        entry.fetcher,
        "https://accounts.spotify.com/api/token",
        { method: "POST", headers: { Authorization: secret }, body: secret },
        entry.signal ?? new AbortController().signal,
        { operation: "token", trackId: "track-id", logger: state.logger },
      ),
      new RegExp(entry.code),
    );
    assertPair(state.events, "failed");
    assert.deepEqual(state.levels, ["INFO", "ERROR"]);
    assert.equal(state.events[1]!.code, entry.code);
    assert.equal(state.events[1]!.httpStatus, entry.httpStatus);
    assert.equal(state.events[1]!.requestId, null);
    assert.ok(!JSON.stringify(state.events).includes(secret));
  }
});

test("throwing loggers cannot change HTTP success or the primary failure", async () => {
  const options = {
    operation: "token" as const,
    trackId: "track-id",
    logger: {
      log() {
        throw new Error("logger failed");
      },
      error() {
        throw new Error("logger failed");
      },
    },
  };
  assert.deepEqual(
    await spotifyJson(
      (async () => Response.json({ ok: true })) as typeof fetch,
      "https://accounts.spotify.com/api/token",
      {},
      new AbortController().signal,
      options,
    ),
    { ok: true },
  );
  await assert.rejects(
    spotifyJson(
      (async () => new Response(null, { status: 429 })) as typeof fetch,
      "https://accounts.spotify.com/api/token",
      {},
      new AbortController().signal,
      options,
    ),
    /SPOTIFY_RATE_LIMITED/,
  );
});

test("per-request timeout logs the safe failure and preserves the HTTP policy", async (t) => {
  const state = capture();
  t.mock.method(AbortSignal, "timeout", (durationMs: number) => {
    assert.equal(durationMs, SPOTIFY_HTTP_POLICY.requestTimeoutMs);
    return AbortSignal.abort(
      new DOMException("synthetic-timeout-marker", "TimeoutError"),
    );
  });
  await assert.rejects(
    spotifyJson(
      (async (_url, init) => {
        init!.signal!.throwIfAborted();
        assert.fail("expected timeout signal");
      }) as typeof fetch,
      "https://api.spotify.com/v1/search",
      {},
      new AbortController().signal,
      { operation: "search", trackId: "track-id", logger: state.logger },
    ),
    /SPOTIFY_REQUEST_FAILED/,
  );
  assertPair(state.events, "failed");
  assert.equal(state.events[1]!.code, "SPOTIFY_REQUEST_FAILED");
  assert.ok(!JSON.stringify(state.events).includes("synthetic-timeout-marker"));
});

test("search request logs show the exact outgoing query parameters on every page", async () => {
  const state = capture();
  const urls: string[] = [];
  const responses = [
    Response.json({ access_token: "synthetic-access-token-marker" }),
    Response.json({ tracks: { items: [], next: "more" } }),
    new Response(null, { status: 429 }),
  ];
  await assert.rejects(
    searchSpotify(
      {
        id: "track-id",
        trackTitle: '  Café: "A&B" \\ Live? + %  ',
        artists: ["An Artist"],
      },
      {
        clientId: "synthetic-client",
        clientSecret: "synthetic-secret-marker",
        market: "GB",
      },
      new AbortController().signal,
      (async (url) => {
        urls.push(String(url));
        return responses.shift()!;
      }) as typeof fetch,
      { logger: state.logger },
    ),
    /SPOTIFY_RATE_LIMITED/,
  );
  const requests = state.events.filter(
    (entry) => entry.event === "spotify_request",
  );
  assert.equal(requests.length, 3);
  assert.equal(requests[0]!.queryParams, undefined);
  for (let page = 0; page < 2; page++) {
    const queryParams = requests[page + 1]!.queryParams;
    assert.deepEqual(
      queryParams,
      Object.fromEntries(new URL(urls[page + 1]!).searchParams),
    );
    assert.deepEqual(queryParams, {
      q: 'track:"Café A&B Live? + %" artist:"An Artist"',
      type: "track",
      market: "GB",
      limit: "10",
      offset: String(page * 10),
    });
  }
  assert.ok(
    !JSON.stringify(state.events).includes("synthetic-access-token-marker"),
  );
});

test("query logging excludes unknown parameters, credentials, fragments and token queries", async () => {
  for (const operation of ["search", "token"] as const) {
    const state = capture();
    const secret = "synthetic-query-secret-marker";
    await spotifyJson(
      (async () => Response.json({})) as typeof fetch,
      `https://user:${secret}@api.spotify.com/v1/search?q=track%3A%22A%26B%22&access_token=${secret}&client_secret=${secret}#${secret}`,
      { headers: { Authorization: `Bearer ${secret}` } },
      new AbortController().signal,
      { operation, trackId: "track-id", logger: state.logger },
    );
    if (operation === "search") {
      assert.deepEqual(state.events[0]!.queryParams, { q: 'track:"A&B"' });
    } else {
      assert.equal(state.events[0]!.queryParams, undefined);
    }
    assert.ok(!JSON.stringify(state.events).includes(secret));
  }
});
