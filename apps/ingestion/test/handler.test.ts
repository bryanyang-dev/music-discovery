import type { Context } from "aws-lambda";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { IngestionError, PITCHFORK_FEED_URL, type IngestionStore, type RunResult, type TrackInput } from "@music-discovery/shared";
import { fetchFeed, type HttpOptions } from "@music-discovery/rss";
import { createHandler } from "../src/handler.ts";
import { INGESTION_TIMING } from "../src/timing.ts";

const html = await readFile(new URL("../../../packages/rss/test/fixtures/review.html", import.meta.url), "utf8");
const sourceUrl = "https://pitchfork.com/reviews/tracks/tinashe-popstar/";
// The logged response shape, with dates represented as Date objects by fetchFeed.
const response = {
  notModified: false as const,
  validators: { etag: null, lastModified: null },
  feed: { found: 1, duplicates: 0, errors: [], entries: [{
    sourceUrl, sourceGuid: "6abad5fba2a3ade8cdd0bd3e", reviewTitle: "“Popstar”",
    reviewAuthor: "Walden Green", reviewPublishedAt: new Date("2026-09-28T21:11:22.000Z"),
    summary: "The title track.", imageUrl: "https://media.pitchfork.com/photos/popstar.jpg",
  }] },
};

function setup() {
  const logs: Record<string, unknown>[] = [];
  const tracks: TrackInput[] = [];
  const finished: RunResult[] = [];
  let closed = 0;
  let signal: AbortSignal | undefined;
  const source = { id: "source", feedUrl: PITCHFORK_FEED_URL, enabled: true, etag: '"cached"', lastModified: null };
  const store: IngestionStore = {
    async getSource() { return source; },
    async beginRun() { return "run"; },
    async recordDiscovery() {},
    async rejectEntry() {},
    async upsertTrack(_source, _run, track) { tracks.push(track); return "inserted"; },
    async finishRun(_source, result) { finished.push(result); return result; },
  };
  const dependencies = {
    databaseUrl: "postgres://unused",
    connect: (_url: string, options: { signal: AbortSignal }) => {
      signal = options.signal;
      return { store, async close() { closed++; } };
    },
    fetch: (async () => response) as typeof fetchFeed,
    http: { fetcher: async () => new Response(html.replaceAll("example-a-song", "tinashe-popstar")) } as HttpOptions,
    sleep: async (_ms: number, _signal: AbortSignal) => {},
    logger: {
      log: (message: string) => { logs.push(JSON.parse(message)); },
      warn: (message: string) => { logs.push(JSON.parse(message)); },
      error: (message: string) => { logs.push(JSON.parse(message)); },
    },
  };
  return { dependencies, store, source, tracks, finished, logs, closed: () => closed, signal: () => signal };
}

const context = (remainingMs: number) => ({ awsRequestId: "request", getRemainingTimeInMillis: () => remainingMs }) as Context;

test("handler logs enriched tracks without writing them to the database", async () => {
  const state = setup();
  state.dependencies.fetch = async (url, validators, options) => {
    assert.equal(url, PITCHFORK_FEED_URL);
    assert.deepEqual(validators, { etag: null, lastModified: null });
    assert.equal(options?.attempts, 1);
    return response;
  };
  const result = await createHandler(state.dependencies)({}, context(300_000));
  assert.equal(result.status, "succeeded");
  assert.equal(state.tracks.length, 0);
  const event = state.logs.find((log) => log.event === "track_extracted");
  const track = event?.track as TrackInput;
  assert.equal(track.sourceGuid, response.feed.entries[0]?.sourceGuid);
  assert.equal(track.summary, "The title track.");
  assert.ok(track.artists.length);
  assert.equal(event?.writeSkipped, true);
  assert.equal(state.finished[0]?.inserted, 0);
  assert.equal(state.closed(), 1);
  assert.ok(state.logs.every((log) => log.requestId === "request"));
});

test("transient RSS failures retain three retries and exponential backoff", async () => {
  const state = setup();
  let attempts = 0;
  const delays: number[] = [];
  state.dependencies.fetch = async () => { attempts++; throw new IngestionError("NETWORK_ERROR", 0); };
  state.dependencies.sleep = async (ms) => { delays.push(ms); };
  await assert.rejects(createHandler(state.dependencies)(), /NETWORK_ERROR/);
  assert.equal(attempts, 4);
  assert.deepEqual(delays, [1_000, 2_000, 4_000]);
  assert.equal(state.finished[0]?.status, "failed");
  assert.equal(state.closed(), 1);
});

test("RSS retries honor Retry-After and can recover", async () => {
  const state = setup();
  let attempts = 0;
  const delays: number[] = [];
  state.dependencies.fetch = async () => {
    if (++attempts === 1) throw new IngestionError("HTTP_ERROR", 5_000);
    return response;
  };
  state.dependencies.sleep = async (ms) => { delays.push(ms); };
  assert.equal((await createHandler(state.dependencies)()).status, "succeeded");
  assert.deepEqual(delays, [5_000]);
});

test("bad review metadata is recorded and later entries can still be logged", async () => {
  const state = setup();
  state.dependencies.fetch = async () => ({ ...response, feed: { ...response.feed, found: 2,
    entries: [{ ...response.feed.entries[0]!, sourceUrl: "https://pitchfork.com/reviews/bad/" }, ...response.feed.entries] } });
  state.dependencies.http.fetcher = async (input) => new Response(String(input).includes("/bad/") ? "<html>bad</html>" : html.replaceAll("example-a-song", "tinashe-popstar"));
  const result = await createHandler(state.dependencies)();
  assert.equal(result.status, "partial_failure");
  assert.equal(state.finished[0]?.rejected, 1);
  assert.equal(state.tracks.length, 0);
  assert.equal(state.logs.filter((log) => log.event === "track_extracted").length, 1);
});

test("304 skips review fetches and writes", async () => {
  const state = setup();
  const handler = createHandler({ ...state.dependencies, fetch: async () => ({ notModified: true, validators: response.validators }),
    http: { fetcher: async () => { assert.fail("must not fetch review"); } } });
  const result = await handler();
  assert.equal(result.status, "succeeded");
  assert.equal(state.finished[0]?.notModified, true);
  assert.equal(state.tracks.length, 0);
  assert.equal(state.closed(), 1);
});

test("disabled sources skip without fetching", async () => {
  const state = setup();
  state.store.getSource = async () => null;
  state.dependencies.fetch = async () => { assert.fail("must not fetch"); };
  assert.deepEqual(await createHandler(state.dependencies)(), { status: "skipped", reason: "disabled" });
  assert.equal(state.closed(), 1);
});

test("missing configuration and database errors are sanitized", async () => {
  for (const missingConfig of [true, false]) {
    const state = setup();
    const handler = createHandler({ ...state.dependencies, databaseUrl: missingConfig ? "" : "postgres://unused",
      connect: () => { throw new Error("private credentials"); } });
    const expectedCode = missingConfig ? "DATABASE_CONFIG_MISSING" : "DATABASE_ERROR";
    await assert.rejects(handler(), (error: unknown) => {
      assert.ok(error instanceof IngestionError);
      assert.equal(error.code, expectedCode);
      return true;
    });
    const log = state.logs.find((event) => event.event === "ingestion_failed");
    assert.equal(log?.code, expectedCode);
    assert.equal(log?.message, new IngestionError(expectedCode).message);
    assert.ok(!JSON.stringify(state.logs).includes("private"));
  }
});

test("cleanup preserves a primary failure and reports a standalone close failure", async () => {
  for (const workFails of [true, false]) {
    const state = setup();
    if (workFails) state.store.getSource = async () => { throw new IngestionError("SOURCE_NOT_FOUND"); };
    const handler = createHandler({ ...state.dependencies, connect: () => ({ store: state.store,
      async close() { throw new Error("private close details"); } }) });
    await assert.rejects(handler(), (error: unknown) => {
      assert.ok(error instanceof IngestionError);
      assert.equal(error.code, workFails ? "SOURCE_NOT_FOUND" : "DATABASE_ERROR");
      if (workFails) assert.deepEqual(error.cleanupErrors, ["DATABASE_ERROR"]);
      return true;
    });
    assert.ok(!JSON.stringify(state.logs).includes("private"));
  }
});

test("work is capped and leaves the database cleanup reserve before Lambda termination", async (t) => {
  const durations: number[] = [];
  const signal = new AbortController().signal;
  t.mock.method(AbortSignal, "timeout", (ms: number) => { durations.push(ms); return signal; });
  const state = setup();
  state.dependencies.fetch = async () => ({ ...response, feed: { ...response.feed, entries: [] } });
  await createHandler(state.dependencies)({}, context(300_000));
  await createHandler(state.dependencies)({}, context(30_000));
  assert.deepEqual(durations, [240_000, 30_000, 30_000 - INGESTION_TIMING.cleanupReserveMs, 30_000]);
  await assert.rejects(createHandler(state.dependencies)({}, context(INGESTION_TIMING.cleanupReserveMs)), /RUN_DEADLINE/);
});

test("database failures do not retry the RSS request", async () => {
  const state = setup();
  let fetches = 0;
  state.dependencies.fetch = async () => { fetches++; return response; };
  state.store.recordDiscovery = async () => { throw new Error("private SQL"); };
  await assert.rejects(createHandler(state.dependencies)(), /DATABASE_ERROR/);
  assert.equal(fetches, 1);
  assert.equal(state.finished[0]?.status, "failed");
  assert.equal(state.closed(), 1);
});

test("cancellation after RSS fetch stops enrichment and still finalizes and closes", async (t) => {
  const controller = new AbortController();
  t.mock.method(AbortSignal, "timeout", () => controller.signal);
  const state = setup();
  state.dependencies.fetch = async () => { controller.abort(new Error("private reason")); return response; };
  state.dependencies.http.fetcher = async () => { assert.fail("must not enrich after cancellation"); };
  await assert.rejects(createHandler(state.dependencies)(), /RUN_DEADLINE/);
  assert.equal(state.finished[0]?.status, "failed");
  assert.equal(state.closed(), 1);
  assert.ok(!JSON.stringify(state.logs).includes("private"));
});

test("run finalization failures still close the database", async () => {
  const state = setup();
  state.store.finishRun = async () => { throw new Error("private SQL"); };
  await assert.rejects(createHandler(state.dependencies)(), /DATABASE_ERROR/);
  assert.equal(state.closed(), 1);
});

test("the handler parses RSS XML before logging enriched tracks", async () => {
  const state = setup();
  const xml = await readFile(new URL("../../../packages/rss/test/fixtures/pitchfork.xml", import.meta.url), "utf8");
  const result = await createHandler({ ...state.dependencies, fetch: fetchFeed, http: {
    fetcher: async (input) => new Response(String(input).includes("/feed/") ? xml : html),
  } })();
  assert.equal(result.status, "succeeded");
  assert.equal(state.tracks.length, 0);
  assert.equal(state.finished[0]?.inserted, 0);
});

test("logs the full parsed feed and every extracted track with the request ID", async () => {
  const state = setup();
  const entries = Array.from({ length: 3 }, (_, index) => ({
    ...response.feed.entries[0]!,
    sourceUrl: `https://pitchfork.com/reviews/tracks/example-${index}/`,
    sourceGuid: `guid-${index}`,
  }));
  const feed = { ...response.feed, entries, found: entries.length };
  state.dependencies.fetch = async () => ({ ...response, feed });
  state.dependencies.http.fetcher = async (input) => new Response(
    html.replaceAll("example-a-song", new URL(String(input)).pathname.split("/").at(-2)!),
  );
  await createHandler(state.dependencies)({}, context(300_000));
  const feeds = state.logs.filter((log) => log.event === "feed_parsed");
  assert.equal(feeds.length, 1);
  assert.deepEqual(feeds[0]?.feed, JSON.parse(JSON.stringify(feed)));
  const tracks = state.logs.filter((log) => log.event === "track_extracted");
  assert.equal(tracks.length, entries.length);
  assert.deepEqual(tracks.map((log) => (log.track as TrackInput).sourceGuid), entries.map((entry) => entry.sourceGuid));
  assert.ok([...feeds, ...tracks].every((log) => log.level === "INFO" && log.requestId === "request"));
  assert.equal(state.tracks.length, 0);
});

test("specific database messages survive startup and failed-run finalization into logs and Lambda errors", async () => {
  for (const code of ["DATABASE_TLS_ERROR", "DATABASE_AUTH_ERROR", "DATABASE_PERMISSION_ERROR"] as const) {
    for (const phase of ["startup", "run"]) {
      const state = setup();
      const failure = new IngestionError(code);
      if (phase === "startup") {
        state.store.getSource = async () => { throw failure; };
      } else {
        state.store.recordDiscovery = async () => { throw failure; };
      }
      await assert.rejects(createHandler(state.dependencies)(), (error: unknown) => {
        assert.ok(error instanceof IngestionError);
        assert.equal(error.code, code);
        assert.equal(error.message, failure.message);
        return true;
      });
      const log = state.logs.find((event) => event.event === "ingestion_failed");
      assert.equal(log?.code, code);
      assert.equal(log?.message, failure.message);
      assert.equal(state.closed(), 1);
    }
  }
});
