import { readFile } from "node:fs/promises";
import {
  extractTrack,
  fetchFeed,
  parseFeed,
  requestPitchfork,
  type ParsedFeed,
} from "@music-discovery/rss";
import { PITCHFORK_FEED_URL, type TrackInput } from "@music-discovery/shared";
import { handler } from "./handler.ts";

async function previewTracks(useFixture: boolean): Promise<void> {
  let feed: ParsedFeed;
  if (useFixture) {
    const fixtureUrl = new URL("../../../packages/rss/test/fixtures/pitchfork.xml", import.meta.url);
    feed = await parseFeed(await readFile(fixtureUrl, "utf8"));
  } else {
    const response = await fetchFeed(PITCHFORK_FEED_URL, { etag: null, lastModified: null });
    if (response.notModified) {
      return;
    }
    feed = response.feed;
  }

  const tracks: TrackInput[] = [];
  for (const entry of feed.entries) {
    if (useFixture) {
      const fixtureUrl = new URL("../../../packages/rss/test/fixtures/review.html", import.meta.url);
      const html = await readFile(fixtureUrl, "utf8");
      tracks.push(extractTrack(entry, html));
    } else {
      const page = await requestPitchfork(entry.sourceUrl, "review");
      tracks.push(extractTrack(entry, page.body, page.url));
    }
  }

  console.log(JSON.stringify({ tracks, rejected: feed.errors.length }, null, 2));
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    await handler();
    return;
  }

  if (args.length !== 1 || !["--preview", "--fixture"].includes(args[0]!)) {
    console.log("Usage: pnpm ingest | pnpm ingest:preview | pnpm ingest:fixture");
    process.exitCode = 1;
    return;
  }

  await previewTracks(args[0] === "--fixture");
}

main().catch(() => {
  console.error("Ingestion failed. Inspect sanitized run records/logs; no credentials were printed.");
  process.exitCode = 1;
});

