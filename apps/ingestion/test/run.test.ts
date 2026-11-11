import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { IngestionError, PITCHFORK_FEED_URL, type CacheValidators, type IngestionStore,
  type RunResult, type SourceRecord, type TrackInput } from "@music-discovery/shared";
import { ingestPitchfork } from "../src/run.ts";

const xml = await readFile(new URL("../../../packages/rss/test/fixtures/pitchfork.xml", import.meta.url), "utf8");
const html = await readFile(new URL("../../../packages/rss/test/fixtures/review.html", import.meta.url), "utf8");
const url = "https://pitchfork.com/reviews/tracks/example-a-song/";

function memoryStore() {
  const source: SourceRecord = {
    id: "source", enabled: true, feedUrl: PITCHFORK_FEED_URL, etag: null, lastModified: null,
  };
  const tracks = new Map<string, TrackInput>();
  const finished: RunResult[] = [];
  const caches: (CacheValidators | null)[] = [];
  const store: IngestionStore = {
    async getSource() { return { ...source }; },
    async beginRun() { return "run"; },
    async recordDiscovery() {},
    async rejectEntry() {},
    async upsertTrack(_source, _runId, track) {
      const previous = tracks.get(track.sourceUrl);
      tracks.set(track.sourceUrl, track);
      if (!previous) {
        return "inserted";
      }
      return JSON.stringify(previous) === JSON.stringify(track) ? "unchanged" : "updated";
    },
    async finishRun(_source, result, validators) {
      finished.push(structuredClone(result));
      caches.push(validators);
      source.etag = validators?.etag ?? null;
      source.lastModified = validators?.lastModified ?? null;
      return result;
    },
  };
  return { store, source, tracks, finished, caches };
}
function fetcher(feed = xml, page = html): typeof fetch {
  return async (input) => String(input).includes("/feed/")
    ? new Response(feed, { headers: { etag: '"version-1"' } }) : new Response(page);
}
function completed(outcome: Awaited<ReturnType<typeof ingestPitchfork>>): RunResult {
  assert.notEqual(outcome.status, "skipped");
  return outcome as RunResult;
}

test("initial import, rerun, and changed metadata produce exact unique upsert counts", async () => {
  const memory = memoryStore();
  const first = completed(await ingestPitchfork(memory.store, { http: { fetcher: fetcher() } }));
  assert.equal(first.inserted, 1);
  assert.equal(first.status, "succeeded");
  const second = completed(await ingestPitchfork(memory.store, { http: { fetcher: fetcher() } }));
  assert.equal(second.inserted, 0);
  assert.equal(second.unchanged, 1);
  const third = completed(await ingestPitchfork(memory.store, { http: {
    fetcher: fetcher(xml, html.replace('headline":"“A Song: Part II”', 'headline":"“A Song: Part III”')),
  } }));
  assert.equal(third.updated, 1);
  assert.equal(memory.tracks.size, 1);
  assert.equal(memory.caches[0]?.etag, '"version-1"');
});
test("a malformed entry does not block a healthy one and clears validators", async () => {
  const memory = memoryStore();
  memory.source.etag = '"old"';
  const feed = xml.replace("</channel>", "<item><title>Invalid entry</title></item></channel>");
  const result = completed(await ingestPitchfork(memory.store, { http: { fetcher: fetcher(feed) } }));
  assert.equal(result.status, "partial_failure");
  assert.equal(result.found, 2);
  assert.equal(result.inserted, 1);
  assert.equal(result.rejected, 1);
  assert.equal(memory.source.etag, null);
  assert.equal(memory.caches[0], null);
});
test("partial page failure retries unconditionally on the next hourly poll", async () => {
  const memory = memoryStore();
  memory.source.etag = '"old"';
  const failed = completed(await ingestPitchfork(memory.store, { http: { fetcher: fetcher(xml, "<html>changed layout</html>") } }));
  assert.equal(failed.status, "partial_failure");
  assert.equal(failed.rejected, 1);
  assert.equal(memory.tracks.size, 0);
  let conditional: string | undefined;
  const recovery: typeof fetch = async (input, init) => {
    if (String(input).includes("/feed/")) {
      conditional = (init?.headers as Record<string, string>)["If-None-Match"];
      return new Response(xml);
    }
    return new Response(html);
  };
  const result = completed(await ingestPitchfork(memory.store, { http: { fetcher: recovery } }));
  assert.equal(conditional, undefined);
  assert.equal(result.inserted, 1);
  assert.equal(result.status, "succeeded");
});
test("one failed review does not block a later valid track", async () => {
  const memory = memoryStore();
  const item = xml.match(/<item>[\s\S]*?<\/item>/)![0];
  const two = xml.replace("</channel>", item.replaceAll("example-a-song", "second-song") + "</channel>");
  const loader: typeof fetch = async (input) => {
    if (String(input).includes("/feed/")) return new Response(two);
    if (String(input).includes("second-song")) return new Response(html.replaceAll("example-a-song", "second-song"));
    return new Response("<html>missing metadata</html>");
  };
  const result = completed(await ingestPitchfork(memory.store, { http: { fetcher: loader } }));
  assert.equal(result.status, "partial_failure");
  assert.equal(result.inserted, 1);
  assert.equal(result.rejected, 1);
  assert.ok(memory.tracks.has(url.replace("example-a-song", "second-song")));
});
test("network, malformed-feed, and database errors fail the run without leaking details", async () => {
  for (const scenario of ["network", "xml", "database"]) {
    const memory = memoryStore();
    if (scenario === "database") memory.store.upsertTrack = async () => { throw new Error("postgres://secret"); };
    const result = completed(await ingestPitchfork(memory.store, { http: {
      fetcher: scenario === "network" ? async () => { throw new Error("secret"); } : fetcher(scenario === "xml" ? "<rss>bad" : xml),
      sleep: async () => {},
    } }));
    assert.equal(result.status, "failed");
    assert.equal(memory.finished.length, 1);
    assert.ok(!JSON.stringify(result).includes("secret"));
    assert.equal(memory.caches[0], null);
  }
});
test("304 is a success without page requests or track writes", async () => {
  const memory = memoryStore();
  memory.source.etag = '"old"';
  let calls = 0;
  const result = completed(await ingestPitchfork(memory.store, { http: {
    fetcher: async () => { calls++; return new Response(null, { status: 304 }); },
  } }));
  assert.equal(calls, 1);
  assert.equal(result.notModified, true);
  assert.equal(result.found, 0);
  assert.equal(result.status, "succeeded");
  assert.equal(memory.source.etag, '"old"');
});
test("empty valid feed is successful and never deletes existing tracks", async () => {
  const memory = memoryStore();
  await ingestPitchfork(memory.store, { http: { fetcher: fetcher() } });
  const result = completed(await ingestPitchfork(memory.store, { http: {
    fetcher: fetcher(xml.replace(/<item>[\s\S]*?<\/item>/, "")),
  } }));
  assert.equal(result.status, "succeeded");
  assert.equal(result.found, 0);
  assert.equal(memory.tracks.size, 1);
});
test("a disabled source skips without fetching or creating a run", async () => {
  const memory = memoryStore();
  memory.store.getSource = async () => null;
  memory.store.beginRun = async () => { throw new Error("must not create a run"); };
  assert.deepEqual(await ingestPitchfork(memory.store), { status: "skipped", reason: "disabled" });
});
test("an expired run budget is recorded", async () => {
  const memory = memoryStore();
  const signal = AbortSignal.abort();
  const result = completed(await ingestPitchfork(memory.store, { signal }));
  assert.equal(result.status, "failed");
  assert.equal(result.errors[0]?.code, "RUN_DEADLINE");
});
test("run finalization failure propagates", async () => {
  const memory = memoryStore();
  const failure = new IngestionError("DATABASE_ERROR");
  memory.store.finishRun = async () => { throw failure; };
  await assert.rejects(ingestPitchfork(memory.store, { http: { fetcher: fetcher() } }),
    (error) => error === failure);
});

test("begin-run failure propagates without fetching", async () => {
  const memory = memoryStore();
  const failure = new Error("db down");
  memory.store.beginRun = async () => { throw failure; };
  await assert.rejects(ingestPitchfork(memory.store, { http: {
    fetcher: async () => { throw new Error("must not fetch"); },
  } }), (error) => error === failure);
});
