import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import {
  fetchPitchforkFeed,
  parsePitchforkFeed,
  extractPitchforkTrack,
  requestPitchfork,
} from "../src/index.ts";
import { IngestionError } from "@music-discovery/shared";

const feedUrl = "https://pitchfork.com/feed/reviews/best/tracks/rss";

const xml = await readFile(
  new URL("./fixtures/pitchfork.xml", import.meta.url),
  "utf8",
);
const html = await readFile(
  new URL("./fixtures/review.html", import.meta.url),
  "utf8",
);
const entry = (await parsePitchforkFeed(xml)).entries[0]!;
const noCache = { etag: null, lastModified: null };
const rejectsCode = (code: string) => (error: unknown) =>
  error instanceof IngestionError && error.code === code;

test("RSS maps critic, thumbnail, dates, title, summary, and canonical identity", async () => {
  const feed = await parsePitchforkFeed(xml);
  assert.equal(feed.found, 1);
  assert.equal(
    feed.entries[0]?.sourceUrl,
    "https://pitchfork.com/reviews/tracks/example-a-song/",
  );
  assert.equal(feed.entries[0]?.reviewAuthor, "Example Critic");
  assert.equal(
    feed.entries[0]?.imageUrl,
    "https://media.pitchfork.com/example.jpg",
  );
  assert.equal(
    feed.entries[0]?.reviewPublishedAt?.toISOString(),
    "2026-11-10T12:00:00.000Z",
  );
  assert.equal(feed.entries[0]?.summary, "A synthetic & concise summary.");
});
test("deduplication ignores fragments/tracking; last valid occurrence wins", async () => {
  const item = xml.match(/<item>[\s\S]*?<\/item>/)![0];
  const duplicate = xml.replace(
    "</channel>",
    item.replace("fixture-track-1", "changed") + "</channel>",
  );
  const parsed = await parsePitchforkFeed(duplicate);
  assert.equal(parsed.found, 2);
  assert.equal(parsed.duplicates, 1);
  assert.equal(parsed.entries.length, 1);
  assert.equal(parsed.entries[0]?.sourceGuid, "changed");
});
test("missing required entry fields are rejected without blocking healthy entries", async () => {
  const parsed = await parsePitchforkFeed(
    xml.replace(
      "</channel>",
      "<item><title>Bad</title><link>https://evil.example/</link></item><item><guid>missing-url</guid></item></channel>",
    ),
  );
  assert.equal(parsed.entries.length, 1);
  assert.equal(parsed.errors.length, 2);
  assert.ok(parsed.errors.every((error) => error.sourceUrl === null));
});
test("wrong feed, malformed XML, entities, and non-UTF8 declarations fail safely", async () => {
  await assert.rejects(
    parsePitchforkFeed(xml.replace("Best New Tracks", "All Reviews")),
    rejectsCode("INVALID_FEED"),
  );
  await assert.rejects(
    parsePitchforkFeed("<rss><channel>"),
    rejectsCode("INVALID_FEED"),
  );
  await assert.rejects(
    parsePitchforkFeed('<!DOCTYPE rss [<!ENTITY x "bad">]>' + xml),
    rejectsCode("INVALID_FEED"),
  );
  await assert.rejects(
    parsePitchforkFeed(xml.replace("utf-8", "iso-8859-1")),
    rejectsCode("UNSUPPORTED_ENCODING"),
  );
});
test("missing optional fields and invalid dates are allowed; an empty feed succeeds", async () => {
  const parsed = await parsePitchforkFeed(
    xml
      .replace(/<pubDate>.*?<\/pubDate>/, "<pubDate>invalid</pubDate>")
      .replace(/<dc:creator>.*?<\/dc:creator>/, ""),
  );
  assert.equal(parsed.entries[0]?.reviewPublishedAt, null);
  assert.equal(parsed.entries[0]?.reviewAuthor, null);
  assert.equal(
    (await parsePitchforkFeed(xml.replace(/<item>[\s\S]*?<\/item>/, ""))).found,
    0,
  );
});
test("JSON-LD plus scoped artist header preserves collaborative names and punctuation", () => {
  const track = extractPitchforkTrack(entry, html);
  assert.equal(track.trackTitle, "A Song: Part II");
  assert.deepEqual(track.artists, ["Example & Band", "Guest"]);
  assert.equal(track.reviewAuthor, "Example Critic");
  assert.deepEqual(track.genres, ["Pop/R&B"]);
  assert.deepEqual(track.labels, ["Example Records"]);
  assert.equal(track.releaseDate, null);
  assert.ok(!track.artists.includes("Not a credited artist"));
  assert.ok(!track.artists.includes("Example Critic"));
});
test("structured byArtist takes priority, including graph schemas", () => {
  const structured =
    '<script type="application/ld+json">' +
    JSON.stringify({
      "@graph": [
        {
          "@type": "Review",
          headline: "“Title & More”",
          itemReviewed: {
            "@type": "MusicRecording",
            byArtist: [{ name: "Band / Name" }, { name: "A, B and C" }],
            genre: ["Electronic"],
            recordLabel: { name: "Label" },
            datePublished: "2026-02-28",
          },
        },
      ],
    }) +
    "</script>";
  const track = extractPitchforkTrack(entry, structured);
  assert.deepEqual(track.artists, ["Band / Name", "A, B and C"]);
  assert.equal(track.trackTitle, "Title & More");
  assert.equal(track.releaseDate, "2026-02-28");
});
test("missing artists, wrong review types, invalid canonical hosts are rejected", () => {
  assert.throws(
    () =>
      extractPitchforkTrack(entry, html.replace(/<a class=[\s\S]*?<\/a>/g, "")),
    rejectsCode("MISSING_METADATA"),
  );
  assert.throws(
    () =>
      extractPitchforkTrack(
        entry,
        html.replace("MusicRecording", "MusicAlbum"),
      ),
    rejectsCode("INVALID_METADATA"),
  );
  assert.throws(
    () =>
      extractPitchforkTrack(
        entry,
        html.replace(
          'rel="canonical" href="https://pitchfork.com',
          'rel="canonical" href="https://evil.example',
        ),
      ),
    rejectsCode("UNSAFE_URL"),
  );
});
test("unrelated JSON-LD and malformed scripts cannot impersonate this review", () => {
  assert.throws(
    () =>
      extractPitchforkTrack(
        entry,
        html.replace(
          '"url":"https://pitchfork.com/reviews/tracks/example-a-song/"',
          '"url":"https://pitchfork.com/reviews/tracks/unrelated/"',
        ),
      ),
    rejectsCode("INVALID_METADATA"),
  );
  const withBadScript =
    '<script type="application/ld+json">{broken</script>' + html;
  assert.equal(
    extractPitchforkTrack(entry, withBadScript).trackTitle,
    "A Song: Part II",
  );
});
test("explicitly matched JSON-LD wins over an unrelated unbound recording review", () => {
  const unrelated =
    '<script type="application/ld+json">' +
    JSON.stringify({
      "@type": "Review",
      headline: "Wrong title",
      itemReviewed: {
        "@type": "MusicRecording",
        byArtist: { name: "Wrong artist" },
      },
    }) +
    "</script>";
  const track = extractPitchforkTrack(entry, unrelated + html);
  assert.equal(track.trackTitle, "A Song: Part II");
  assert.deepEqual(track.artists, ["Example & Band", "Guest"]);
  assert.throws(
    () => extractPitchforkTrack(entry, unrelated + unrelated),
    rejectsCode("INVALID_METADATA"),
  );
});
test("conditional fetch sends validators and handles 304 without parsing", async () => {
  const fetcher: typeof fetch = async (_input, init) => {
    assert.equal(
      (init?.headers as Record<string, string>)["If-None-Match"],
      '"old"',
    );
    assert.equal(init?.redirect, "manual");
    return new Response(null, { status: 304 });
  };
  const result = await fetchPitchforkFeed(
    feedUrl,
    { etag: '"old"', lastModified: null },
    { fetcher },
  );
  assert.equal(result.notModified, true);
  assert.equal(result.validators.etag, '"old"');
  await assert.rejects(
    fetchPitchforkFeed(feedUrl, noCache, {
      fetcher: async () => new Response(null, { status: 304 }),
    }),
    rejectsCode("INVALID_FEED"),
  );
});
test("new response validators are returned only alongside a valid parsed feed", async () => {
  const result = await fetchPitchforkFeed(feedUrl, noCache, {
    fetcher: async () =>
      new Response(xml, {
        headers: {
          etag: '"new"',
          "last-modified": "Tue, 10 Nov 2026 12:00:00 GMT",
        },
      }),
  });
  assert.equal(result.notModified, false);
  assert.equal(result.validators.etag, '"new"');
});
test("HTTP failures are retried only when transient and honor Retry-After", async () => {
  let calls = 0;
  const waits: number[] = [];
  const fetcher: typeof fetch = async () =>
    ++calls === 1
      ? new Response("", { status: 429, headers: { "retry-after": "2" } })
      : new Response(xml);
  await fetchPitchforkFeed(feedUrl, noCache, {
    fetcher,
    sleep: async (ms) => {
      waits.push(ms);
    },
  });
  assert.equal(calls, 2);
  assert.deepEqual(waits, [2000]);
  calls = 0;
  await assert.rejects(
    fetchPitchforkFeed(feedUrl, noCache, {
      fetcher: async () => {
        calls++;
        return new Response("", { status: 403 });
      },
    }),
    rejectsCode("HTTP_ERROR"),
  );
  assert.equal(calls, 1);
});
test("long Retry-After is not shortened; timeout/network retry counts are bounded", async () => {
  let calls = 0;
  await assert.rejects(
    fetchPitchforkFeed(feedUrl, noCache, {
      fetcher: async () => {
        calls++;
        return new Response("", {
          status: 503,
          headers: { "retry-after": "60" },
        });
      },
    }),
    rejectsCode("HTTP_ERROR"),
  );
  assert.equal(calls, 1);
  calls = 0;
  await assert.rejects(
    fetchPitchforkFeed(feedUrl, noCache, {
      fetcher: async () => {
        calls++;
        throw new Error("network error with secret");
      },
      sleep: async () => {},
    }),
    rejectsCode("NETWORK_ERROR"),
  );
  assert.equal(calls, 3);
});
test("redirects must stay on approved hosts, protocols, ports, and review paths", async () => {
  for (const destination of [
    "https://127.0.0.1/reviews/x/",
    "http://pitchfork.com/reviews/x/",
    "https://pitchfork.com:444/reviews/x/",
    "https://pitchfork.com/feed/rss",
  ]) {
    let calls = 0;
    await assert.rejects(
      requestPitchfork(
        entry.sourceUrl,
        "review",
        {},
        {
          fetcher: async () => {
            calls++;
            return new Response(null, {
              status: 302,
              headers: { location: destination },
            });
          },
        },
      ),
      rejectsCode("UNSAFE_URL"),
    );
    assert.equal(calls, 1);
  }
  let calls = 0;
  const safe = await requestPitchfork(
    entry.sourceUrl,
    "review",
    {},
    {
      fetcher: async () =>
        ++calls === 1
          ? new Response(null, {
              status: 301,
              headers: { location: "/reviews/tracks/canonical/" },
            })
          : new Response(html),
    },
  );
  assert.equal(safe.url, "https://pitchfork.com/reviews/tracks/canonical/");
});
test("decompressed body limits and invalid UTF-8 reject responses", async () => {
  await assert.rejects(
    fetchPitchforkFeed(feedUrl, noCache, {
      maxBytes: 4,
      fetcher: async () => new Response(xml),
    }),
    rejectsCode("RESPONSE_TOO_LARGE"),
  );
  await assert.rejects(
    fetchPitchforkFeed(feedUrl, noCache, {
      fetcher: async () => new Response(new Uint8Array([0xff, 0xff])),
    }),
    rejectsCode("UNSUPPORTED_ENCODING"),
  );
});
test("abort signals stop retries and an in-flight request", async () => {
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    fetchPitchforkFeed(feedUrl, noCache, {
      signal: controller.signal,
      fetcher: async () => {
        throw new Error("must not call fetch");
      },
    }),
    rejectsCode("RUN_DEADLINE"),
  );
  const keeper = setTimeout(() => {}, 200);
  try {
    await assert.rejects(
      fetchPitchforkFeed(feedUrl, noCache, {
        timeoutMs: 5,
        attempts: 1,
        fetcher: async (_input, init) => {
          await new Promise((_resolve, reject) =>
            init?.signal?.addEventListener(
              "abort",
              () => reject(new Error("aborted")),
              { once: true },
            ),
          );
          return new Response("");
        },
      }),
      rejectsCode("REQUEST_TIMEOUT"),
    );
  } finally {
    clearTimeout(keeper);
  }
});
