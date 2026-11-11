import type { Context } from "aws-lambda";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { fetchFeed } from "@music-discovery/rss";
import { IngestionError, PITCHFORK_FEED_URL } from "@music-discovery/shared";
import { createHandler } from "../src/handler.ts";

const fixture = await readFile(new URL("../../../packages/rss/test/fixtures/pitchfork.xml", import.meta.url), "utf8");

function createTestLogger(logs: string[]) {
  return {
    log: (message: string) => logs.push(message),
    warn: (message: string) => logs.push(message),
    error: (message: string) => logs.push(message),
  };
}

function createLambdaContext(remainingTimeMs: number): Context {
  return {
    callbackWaitsForEmptyEventLoop: false,
    functionName: "musicRssFetcher",
    functionVersion: "$LATEST",
    invokedFunctionArn: "arn:aws:lambda:us-east-2:783161622181:function:musicRssFetcher",
    memoryLimitInMB: "128",
    awsRequestId: "test-request",
    logGroupName: "/aws/lambda/musicRssFetcher",
    logStreamName: "test-stream",
    getRemainingTimeInMillis: () => remainingTimeMs,
    done() {},
    fail() {},
    succeed() {},
  };
}

test("handler fetches, parses, logs and returns RSS without database configuration", async () => {
  const logs: string[] = [];
  const handler = createHandler({
    fetch: async (url, validators, options) => {
      assert.equal(url, PITCHFORK_FEED_URL);
      assert.deepEqual(validators, { etag: null, lastModified: null });
      assert.ok(options?.signal);
      assert.equal(options.attempts, 1);
      return fetchFeed(url, validators, {
        ...options,
        fetcher: async () => new Response(fixture, { headers: { etag: '"fixture"' } }),
      });
    },
    logger: createTestLogger(logs),
  });

  const result = await handler({ feedUrl: "https://untrusted.example/" });
  assert.equal(result.notModified, false);
  if (result.notModified) {
    assert.fail("expected parsed RSS");
  }
  assert.ok(result.feed.entries.length > 0);
  assert.equal(result.validators.etag, '"fixture"');
  assert.equal(logs.length, 2);
  assert.equal(JSON.parse(logs[0]!).event, "rss_fetch_started");
  assert.equal(JSON.parse(logs[1]!).event, "rss_fetch_succeeded");
  assert.deepEqual(JSON.parse(logs[1]!).response, JSON.parse(JSON.stringify(result)));
});

test("handler sanitizes fetch failures before logging and throwing", async () => {
  const logs: string[] = [];
  const handler = createHandler({
    fetch: async () => { throw new Error("private connection detail"); },
    logger: createTestLogger(logs),
  });

  await assert.rejects(handler(), /HTTP_ERROR/);
  assert.deepEqual(logs.map((message) => JSON.parse(message)), [
    { event: "rss_fetch_started", level: "INFO", requestId: null, attempt: 1 },
    { event: "rss_fetch_attempt_failed", level: "WARN", requestId: null, attempt: 1, code: "HTTP_ERROR" },
    { event: "rss_fetch_failed", level: "ERROR", requestId: null, attempt: 1, code: "HTTP_ERROR" },
  ]);
});

test("invalid RSS is reported without logging its body", async () => {
  const logs: string[] = [];
  const handler = createHandler({
    fetch: (url, validators, options) => fetchFeed(url, validators, {
      ...options,
      fetcher: async () => new Response("private malformed XML"),
    }),
    logger: createTestLogger(logs),
  });

  await assert.rejects(handler(), /INVALID_FEED/);
  assert.deepEqual(logs.map((message) => JSON.parse(message)), [
    { event: "rss_fetch_started", level: "INFO", requestId: null, attempt: 1 },
    { event: "rss_fetch_attempt_failed", level: "WARN", requestId: null, attempt: 1, code: "INVALID_FEED" },
    { event: "rss_fetch_failed", level: "ERROR", requestId: null, attempt: 1, code: "INVALID_FEED" },
  ]);
});

test("an invocation too near its deadline fails before fetching RSS", async () => {
  let fetched = false;
  const logs: string[] = [];
  const handler = createHandler({
    fetch: async () => {
      fetched = true;
      throw new Error("must not fetch");
    },
    logger: createTestLogger(logs),
  });

  for (const remainingMs of [0, 100, 250]) {
    await assert.rejects(handler({}, createLambdaContext(remainingMs)), /RUN_DEADLINE/);
  }
  assert.equal(fetched, false);
  const events = logs.map((message) => JSON.parse(message));
  assert.equal(events.filter((event) => event.event === "rss_fetch_aborted").length, 3);
  assert.ok(events.every((event) => event.attempt === 0 && event.requestId === "test-request"));
  assert.ok(!events.some((event) => event.event === "rss_fetch_max_attempts_reached"));
});

test("RSS uses a 30-second cap, a 250-millisecond response margin, and the same cancellation signal", async (context) => {
  const durations: number[] = [];
  const signal = new AbortController().signal;
  context.mock.method(AbortSignal, "timeout", (duration: number) => {
    durations.push(duration);
    return signal;
  });
  const handler = createHandler({
    fetch: async (_url, _validators, options) => {
      assert.equal(options?.signal, signal);
      return { notModified: false, validators: { etag: null, lastModified: null },
        feed: { found: 0, duplicates: 0, entries: [], errors: [] } };
    },
    logger: createTestLogger([]),
  });

  await handler();
  for (const remainingMs of [60_000, 30_000, 3_000, 251]) {
    await handler({}, createLambdaContext(remainingMs));
  }
  assert.deepEqual(durations, [30_000, 30_000, 29_750, 2_750, 1]);
});

const emptyResponse = {
  notModified: false as const,
  validators: { etag: null, lastModified: null },
  feed: { found: 0, duplicates: 0, entries: [], errors: [] },
};

test("transient failures get exactly three retries with exponential backoff and correlated logs", async () => {
  const logs: string[] = [];
  const delays: number[] = [];
  let attempts = 0;
  let sharedSignal: AbortSignal | undefined;
  const failure = new IngestionError("NETWORK_ERROR", 0);
  const handler = createHandler({
    fetch: async (_url, _validators, options) => {
      attempts++;
      assert.equal(options?.attempts, 1);
      sharedSignal ??= options?.signal;
      assert.equal(options?.signal, sharedSignal);
      throw failure;
    },
    sleep: async (delayMs, signal) => {
      assert.equal(signal, sharedSignal);
      delays.push(delayMs);
    },
    logger: createTestLogger(logs),
  });

  await assert.rejects(handler({}, createLambdaContext(30_000)), (error) => error === failure);
  assert.equal(attempts, 4);
  assert.deepEqual(delays, [1_000, 2_000, 4_000]);
  const events = logs.map((message) => JSON.parse(message));
  assert.ok(events.every((event) => event.requestId === "test-request"));
  assert.deepEqual(events.filter((event) => event.event === "rss_fetch_started").map((event) => event.attempt), [1, 2, 3, 4]);
  assert.equal(events.filter((event) => event.event === "rss_fetch_attempt_failed").length, 4);
  assert.equal(events.filter((event) => event.event === "rss_fetch_retry_scheduled").length, 3);
  assert.deepEqual(events.filter((event) => event.event === "rss_fetch_max_attempts_reached"), [
    { event: "rss_fetch_max_attempts_reached", level: "ERROR", requestId: "test-request", attempt: 4, maxAttempts: 4, code: "NETWORK_ERROR" },
  ]);
  assert.ok(!events.some((event) => event.event === "rss_fetch_aborted"));
  assert.deepEqual(events.at(-1), { event: "rss_fetch_failed", level: "ERROR", requestId: "test-request", attempt: 4, code: "NETWORK_ERROR" });
});

test("a retry can succeed and logs one success without a final failure", async () => {
  const logs: string[] = [];
  let attempts = 0;
  const handler = createHandler({
    fetch: async () => {
      attempts++;
      if (attempts < 3) {
        throw new IngestionError("REQUEST_TIMEOUT", 0);
      }
      return emptyResponse;
    },
    sleep: async () => {},
    logger: createTestLogger(logs),
  });

  assert.equal(await handler(), emptyResponse);
  assert.equal(attempts, 3);
  const events = logs.map((message) => JSON.parse(message));
  assert.equal(events.filter((event) => event.event === "rss_fetch_succeeded").length, 1);
  assert.equal(events.at(-1).attempt, 3);
  assert.ok(!events.some((event) => event.event === "rss_fetch_failed"));
  assert.ok(!events.some((event) => event.event === "rss_fetch_max_attempts_reached" || event.event === "rss_fetch_aborted"));
});

test("permanent HTTP errors and invalid feeds never retry", async () => {
  for (const failure of [new IngestionError("HTTP_ERROR"), new IngestionError("INVALID_FEED")]) {
    let attempts = 0;
    const handler = createHandler({
      fetch: async () => { attempts++; throw failure; },
      sleep: async () => { assert.fail("must not retry"); },
      logger: createTestLogger([]),
    });
    await assert.rejects(handler(), (error) => error === failure);
    assert.equal(attempts, 1);
  }
});

test("retry delay honors Retry-After instead of retrying earlier", async () => {
  const delays: number[] = [];
  let attempts = 0;
  const handler = createHandler({
    fetch: async () => {
      attempts++;
      if (attempts === 1) {
        throw new IngestionError("HTTP_ERROR", 5_000);
      }
      return emptyResponse;
    },
    sleep: async (delayMs) => { delays.push(delayMs); },
    logger: createTestLogger([]),
  });
  await handler();
  assert.deepEqual(delays, [5_000]);
});

test("exhausting the deadline during backoff stops retries and logs a final deadline failure", async (context) => {
  const controller = new AbortController();
  context.mock.method(AbortSignal, "timeout", () => controller.signal);
  const logs: string[] = [];
  let attempts = 0;
  const handler = createHandler({
    fetch: async () => { attempts++; throw new IngestionError("NETWORK_ERROR", 0); },
    sleep: async () => { controller.abort(); throw controller.signal.reason; },
    logger: createTestLogger(logs),
  });
  await assert.rejects(handler(), /RUN_DEADLINE/);
  assert.equal(attempts, 1);
  const events = logs.map((message) => JSON.parse(message));
  assert.deepEqual(events.filter((event) => event.event === "rss_fetch_aborted"), [
    { event: "rss_fetch_aborted", level: "ERROR", requestId: null, attempt: 1, code: "RUN_DEADLINE" },
  ]);
  assert.ok(!events.some((event) => event.event === "rss_fetch_max_attempts_reached"));
  assert.deepEqual(JSON.parse(logs.at(-1)!), { event: "rss_fetch_failed", level: "ERROR", requestId: null, attempt: 1, code: "RUN_DEADLINE" });
});

test("an in-flight abort logs one abort and one terminal failure without exposing the abort reason", async (context) => {
  const controller = new AbortController();
  context.mock.method(AbortSignal, "timeout", () => controller.signal);
  const logs: string[] = [];
  const handler = createHandler({
    fetch: async () => {
      controller.abort(new Error("private abort detail"));
      throw controller.signal.reason;
    },
    sleep: async () => { assert.fail("must not retry after abort"); },
    logger: createTestLogger(logs),
  });

  await assert.rejects(handler({}, createLambdaContext(3_000)), /RUN_DEADLINE/);
  const events = logs.map((message) => JSON.parse(message));
  assert.deepEqual(events.filter((event) => event.event === "rss_fetch_aborted"), [
    { event: "rss_fetch_aborted", level: "ERROR", requestId: "test-request", attempt: 1, code: "RUN_DEADLINE" },
  ]);
  assert.equal(events.filter((event) => event.event === "rss_fetch_failed").length, 1);
  assert.ok(!events.some((event) => event.event === "rss_fetch_max_attempts_reached"));
  assert.ok(logs.every((message) => !message.includes("private")));
});

test("HTTP retry loop is disabled in the real feed fetcher", async () => {
  let requests = 0;
  const delays: number[] = [];
  const handler = createHandler({
    fetch: (url, validators, options) => fetchFeed(url, validators, {
      ...options,
      fetcher: async () => { requests++; return new Response("unavailable", { status: 503 }); },
    }),
    sleep: async (delayMs) => { delays.push(delayMs); },
    logger: createTestLogger([]),
  });
  await assert.rejects(handler(), /HTTP_ERROR/);
  assert.equal(requests, 4);
  assert.deepEqual(delays, [1_000, 2_000, 4_000]);
});

test("default logger sends normal, retry, and terminal events to the matching console method", async (context) => {
  const messages: { method: string; payload: Record<string, unknown> }[] = [];
  for (const method of ["log", "warn", "error"] as const) {
    context.mock.method(console, method, (message: string) => {
      messages.push({ method, payload: JSON.parse(message) });
    });
  }
  const failing = createHandler({
    fetch: async () => { throw new IngestionError("NETWORK_ERROR", 0); },
    sleep: async () => {},
  });
  await assert.rejects(failing({}, createLambdaContext(30_000)), /NETWORK_ERROR/);
  const succeeding = createHandler({ fetch: async () => emptyResponse });
  await succeeding({}, createLambdaContext(30_000));
  await assert.rejects(succeeding({}, createLambdaContext(100)), /RUN_DEADLINE/);

  const expectedLevels = { log: "INFO", warn: "WARN", error: "ERROR" };
  for (const method of ["log", "warn", "error"] as const) {
    const matching = messages.filter((message) => message.method === method);
    assert.ok(matching.length > 0);
    assert.ok(matching.every((message) => message.payload.level === expectedLevels[method]));
  }
  for (const event of ["rss_fetch_aborted", "rss_fetch_max_attempts_reached", "rss_fetch_failed"]) {
    assert.ok(messages.some((message) => message.method === "error" && message.payload.event === event));
  }
  assert.ok(messages.some((message) => message.method === "warn" && message.payload.event === "rss_fetch_retry_scheduled"));
  assert.ok(messages.some((message) => message.method === "log" && message.payload.event === "rss_fetch_succeeded"));
});
