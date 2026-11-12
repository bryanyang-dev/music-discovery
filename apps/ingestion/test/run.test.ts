import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import {
  IngestionError,
  type CacheValidators,
  type IngestionStore,
  type RunResult,
  type SourceRecord,
  type TrackInput,
} from "@music-discovery/shared";
import { ingestSource } from "../src/run.ts";

const feedUrl = "https://pitchfork.com/feed/reviews/best/tracks/rss";

const xml = await readFile(
  new URL("../../../packages/rss/test/fixtures/pitchfork.xml", import.meta.url),
  "utf8",
);
const html = await readFile(
  new URL("../../../packages/rss/test/fixtures/review.html", import.meta.url),
  "utf8",
);
const url = "https://pitchfork.com/reviews/tracks/example-a-song/";

function memoryStore() {
  const source: SourceRecord = {
    id: "source",
    key: "pitchfork_best_new_tracks",
    name: "pitchfork",
    category: "best_new_track",
    enabled: true,
    feedUrl,
    etag: null,
    lastModified: null,
  };
  const tracks = new Map<string, TrackInput>();
  const finished: RunResult[] = [];
  const caches: (CacheValidators | null)[] = [];
  const store: IngestionStore = {
    async getSource() {
      return { ...source };
    },
    async beginRun() {
      return "run";
    },
    async recordDiscovery() {},
    async rejectEntry() {},
    async upsertTrack(_source, _runId, track) {
      const previous = tracks.get(track.sourceUrl);
      tracks.set(track.sourceUrl, track);
      if (!previous) {
        return "inserted";
      }
      return JSON.stringify(previous) === JSON.stringify(track)
        ? "unchanged"
        : "updated";
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
  return async (input) =>
    String(input).includes("/feed/")
      ? new Response(feed, { headers: { etag: '"version-1"' } })
      : new Response(page);
}
function completed(
  outcome: Awaited<ReturnType<typeof ingestSource>>,
): RunResult {
  assert.notEqual(outcome.status, "skipped");
  return outcome as RunResult;
}

test("upserts classify inserted, unchanged and updated tracks across runs", async () => {
  const memory = memoryStore();
  const extracted: TrackInput[] = [];
  for (const outcome of ["inserted", "unchanged", "updated"] as const) {
    const page =
      outcome === "updated" ? html.replaceAll("A Song", "Updated Song") : html;
    const result = completed(
      await ingestSource(memory.store, "pitchfork_best_new_tracks", {
        http: { fetcher: fetcher(xml, page) },
        onTrackExtracted: (track) => extracted.push(track),
      }),
    );
    assert.equal(result.status, "succeeded");
    assert.equal(result.notModified, false);
    assert.equal(result.seen, 1);
    assert.equal(result.existing, Number(outcome !== "inserted"));
    assert.deepEqual(
      [result.inserted, result.updated, result.unchanged],
      [
        Number(outcome === "inserted"),
        Number(outcome === "updated"),
        Number(outcome === "unchanged"),
      ],
    );
    assert.deepEqual(memory.caches.at(-1), {
      etag: '"version-1"',
      lastModified: null,
    });
  }
  assert.equal(memory.tracks.size, 1);
  assert.equal(extracted.length, 3);
  assert.ok(extracted[0]?.artists.length);
  assert.equal(extracted[0]?.sourceUrl, url);
});
test("a malformed entry does not block a healthy one and clears validators", async () => {
  const memory = memoryStore();
  memory.source.etag = '"old"';
  const feed = xml.replace(
    "</channel>",
    "<item><title>Invalid entry</title></item></channel>",
  );
  const result = completed(
    await ingestSource(memory.store, "pitchfork_best_new_tracks", {
      http: { fetcher: fetcher(feed) },
    }),
  );
  assert.equal(result.status, "partial_failure");
  assert.equal(result.found, 2);
  assert.equal(result.inserted, 1);
  assert.equal(result.rejected, 1);
  assert.equal(result.seen, 1);
  assert.equal(result.existing, 0);
  assert.equal(memory.source.etag, null);
  assert.equal(memory.caches[0], null);
});
test("partial page failure retries unconditionally on the next hourly poll", async () => {
  const memory = memoryStore();
  memory.source.etag = '"old"';
  const failed = completed(
    await ingestSource(memory.store, "pitchfork_best_new_tracks", {
      http: { fetcher: fetcher(xml, "<html>changed layout</html>") },
    }),
  );
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
  const result = completed(
    await ingestSource(memory.store, "pitchfork_best_new_tracks", {
      http: { fetcher: recovery },
    }),
  );
  assert.equal(conditional, undefined);
  assert.equal(result.inserted, 1);
  assert.equal(result.status, "succeeded");
});
test("one failed review does not block a later valid track", async () => {
  const memory = memoryStore();
  const item = xml.match(/<item>[\s\S]*?<\/item>/)![0];
  const two = xml.replace(
    "</channel>",
    item.replaceAll("example-a-song", "second-song") + "</channel>",
  );
  const loader: typeof fetch = async (input) => {
    if (String(input).includes("/feed/")) return new Response(two);
    if (String(input).includes("second-song"))
      return new Response(html.replaceAll("example-a-song", "second-song"));
    return new Response("<html>missing metadata</html>");
  };
  const result = completed(
    await ingestSource(memory.store, "pitchfork_best_new_tracks", {
      http: { fetcher: loader },
    }),
  );
  assert.equal(result.status, "partial_failure");
  assert.equal(result.inserted, 1);
  assert.equal(result.rejected, 1);
  assert.equal(memory.tracks.size, 1);
});
test("network, malformed-feed, and database errors fail the run without leaking details", async () => {
  for (const scenario of ["network", "xml", "database"]) {
    const memory = memoryStore();
    if (scenario === "database")
      memory.store.recordDiscovery = async () => {
        throw new Error("postgres://secret");
      };
    const result = completed(
      await ingestSource(memory.store, "pitchfork_best_new_tracks", {
        http: {
          fetcher:
            scenario === "network"
              ? async () => {
                  throw new Error("secret");
                }
              : fetcher(scenario === "xml" ? "<rss>bad" : xml),
          sleep: async () => {},
        },
      }),
    );
    assert.equal(result.status, "failed");
    assert.equal(memory.finished.length, 1);
    assert.ok(!JSON.stringify(result).includes("secret"));
    assert.equal(memory.caches[0], null);
  }
});
test("304 reuses cached validators without page requests or track writes", async () => {
  const memory = memoryStore();
  memory.source.etag = '"old"';
  memory.source.lastModified = "Tue, 10 Nov 2026 12:00:00 GMT";
  let calls = 0;
  const result = completed(
    await ingestSource(memory.store, "pitchfork_best_new_tracks", {
      http: {
        fetcher: async (_input, init) => {
          calls++;
          const headers = new Headers(init?.headers);
          assert.equal(headers.get("If-None-Match"), memory.source.etag);
          assert.equal(
            headers.get("If-Modified-Since"),
            memory.source.lastModified,
          );
          return new Response(null, { status: 304 });
        },
      },
    }),
  );
  assert.equal(calls, 1);
  assert.equal(result.notModified, true);
  assert.equal(result.seen, 0);
  assert.equal(result.inserted, 0);
  assert.equal(result.existing, 0);
  assert.equal(result.found, 0);
  assert.equal(result.status, "succeeded");
  assert.deepEqual(memory.caches[0], {
    etag: '"old"',
    lastModified: memory.source.lastModified,
  });
  assert.equal(memory.tracks.size, 0);
});

test("a failed write preserves earlier commits, stops later entries and clears validators", async () => {
  const memory = memoryStore();
  memory.source.etag = '"old"';
  const item = xml.match(/<item>[\s\S]*?<\/item>/)![0];
  const feed = xml.replace(
    "</channel>",
    item.replaceAll("example-a-song", "second-song") +
      item.replaceAll("example-a-song", "third-song") +
      "</channel>",
  );
  const upsert = memory.store.upsertTrack;
  let writes = 0;
  memory.store.upsertTrack = async (...args) => {
    if (++writes === 2) {
      throw new Error("private SQL and credentials");
    }
    return upsert(...args);
  };
  const result = completed(
    await ingestSource(memory.store, "pitchfork_best_new_tracks", {
      http: {
        fetcher: async (input) =>
          String(input).includes("/feed/")
            ? new Response(feed, { headers: { etag: '"new"' } })
            : new Response(
                html.replaceAll(
                  "example-a-song",
                  new URL(String(input)).pathname.split("/").at(-2)!,
                ),
              ),
      },
    }),
  );
  assert.equal(result.status, "failed");
  assert.equal(result.inserted, 1);
  assert.equal(result.rejected, 0);
  assert.equal(result.found, 3);
  assert.equal(result.seen, 2);
  assert.equal(result.existing, 0);
  assert.equal(writes, 2);
  assert.equal(memory.tracks.size, 1);
  assert.ok(memory.tracks.has(url));
  assert.equal(memory.finished.length, 1);
  assert.equal(memory.caches[0], null);
  assert.equal(result.errors[0]?.code, "DATABASE_ERROR");
  assert.ok(!JSON.stringify(result).includes("private"));
});
test("empty valid feed is successful and never deletes existing tracks", async () => {
  const memory = memoryStore();
  await ingestSource(memory.store, "pitchfork_best_new_tracks", {
    http: { fetcher: fetcher() },
  });
  const result = completed(
    await ingestSource(memory.store, "pitchfork_best_new_tracks", {
      http: {
        fetcher: fetcher(xml.replace(/<item>[\s\S]*?<\/item>/, "")),
      },
    }),
  );
  assert.equal(result.status, "succeeded");
  assert.equal(result.found, 0);
  assert.equal(memory.tracks.size, 1);
});
test("a disabled source skips without fetching or creating a run", async () => {
  const memory = memoryStore();
  memory.store.getSource = async () => null;
  memory.store.beginRun = async () => {
    throw new Error("must not create a run");
  };
  assert.deepEqual(
    await ingestSource(memory.store, "pitchfork_best_new_tracks"),
    { status: "skipped", reason: "disabled" },
  );
});

test("unsupported stored publisher metadata fails before creating a run or fetching", async () => {
  const memory = memoryStore();
  memory.source.name = "unsupported";
  memory.store.beginRun = async () => {
    assert.fail("unsupported sources must not start a run");
  };
  await assert.rejects(
    ingestSource(memory.store, "another_feed", {
      fetch: async () => {
        assert.fail("unsupported sources must not fetch");
      },
    }),
    /UNSUPPORTED_SOURCE/,
  );
});
test("an expired run budget is recorded", async () => {
  const memory = memoryStore();
  const signal = AbortSignal.abort();
  const result = completed(
    await ingestSource(memory.store, "pitchfork_best_new_tracks", {
      signal,
      http: {
        fetcher: async () => {
          assert.fail("must not request a feed after cancellation");
        },
      },
    }),
  );
  assert.equal(result.status, "failed");
  assert.equal(result.errors[0]?.code, "RUN_DEADLINE");
});
test("run finalization failure propagates", async () => {
  const memory = memoryStore();
  const failure = new IngestionError("DATABASE_ERROR");
  memory.store.finishRun = async () => {
    throw failure;
  };
  await assert.rejects(
    ingestSource(memory.store, "pitchfork_best_new_tracks", {
      http: { fetcher: fetcher() },
    }),
    (error) => error === failure,
  );
});

test("begin-run failure propagates without fetching", async () => {
  const memory = memoryStore();
  const failure = new Error("db down");
  memory.store.beginRun = async () => {
    throw failure;
  };
  await assert.rejects(
    ingestSource(memory.store, "pitchfork_best_new_tracks", {
      http: {
        fetcher: async () => {
          throw new Error("must not fetch");
        },
      },
    }),
    (error) => error === failure,
  );
});

test("failed run finalization preserves the original fetch failure", async () => {
  const memory = memoryStore();
  memory.store.finishRun = async () => {
    throw new Error("private cleanup failure");
  };
  const failure = new IngestionError("NETWORK_ERROR");
  await assert.rejects(
    ingestSource(memory.store, "pitchfork_best_new_tracks", {
      fetch: async () => {
        throw failure;
      },
    }),
    (error) => {
      assert.equal(error, failure);
      assert.deepEqual(failure.cleanupErrors, ["DATABASE_ERROR"]);
      return true;
    },
  );
});

test("review cancellation stops processing without rejecting entries or writing tracks", async () => {
  const memory = memoryStore();
  const controller = new AbortController();
  memory.store.rejectEntry = async () => {
    assert.fail("cancellation is not an entry failure");
  };
  const result = completed(
    await ingestSource(memory.store, "pitchfork_best_new_tracks", {
      signal: controller.signal,
      http: {
        fetcher: async (input) => {
          if (String(input).includes("/feed/")) {
            return new Response(xml);
          }
          controller.abort(new Error("private cancellation reason"));
          return new Response(html);
        },
      },
    }),
  );
  assert.equal(result.status, "failed");
  assert.equal(result.errors[0]?.code, "RUN_DEADLINE");
  assert.equal(result.rejected, 0);
  assert.equal(memory.tracks.size, 0);
  assert.equal(memory.finished.length, 1);
  assert.equal(memory.caches[0], null);
  assert.ok(!JSON.stringify(result).includes("private"));
});

test("mixed new and existing tracks report explicit totals", async () => {
  const memory = memoryStore();
  const item = xml.match(/<item>[\s\S]*?<\/item>/)![0];
  const feed = xml.replace(
    "</channel>",
    item.replaceAll("example-a-song", "second-song") +
      item.replaceAll("example-a-song", "third-song") +
      "</channel>",
  );
  const outcomes = ["inserted", "updated", "unchanged"] as const;
  let index = 0;
  memory.store.upsertTrack = async () => outcomes[index++]!;
  const result = completed(
    await ingestSource(memory.store, memory.source.key, {
      http: { fetcher: fetcher(feed) },
    }),
  );
  assert.equal(result.found, 3);
  assert.equal(result.seen, 3);
  assert.equal(result.inserted, 1);
  assert.equal(result.existing, 2);
  assert.equal(result.updated, 1);
  assert.equal(result.unchanged, 1);
  assert.equal(result.notModified, false);
});
