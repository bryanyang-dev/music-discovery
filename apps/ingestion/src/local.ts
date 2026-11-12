import { readFile } from "node:fs/promises";
import { connectDatabase } from "@music-discovery/db";
import {
  extractPitchforkTrack,
  parsePitchforkFeed,
} from "@music-discovery/rss";
import {
  errorCode,
  IngestionError,
  toIngestionError,
  validateSourceKey,
  type TrackInput,
} from "@music-discovery/shared";
import { handler } from "./handler.ts";
import { previewSource } from "./preview.ts";

function logTrack(track: TrackInput): void {
  console.log(
    JSON.stringify({
      event: "track_extracted",
      level: "INFO",
      track,
      writeSkipped: true,
    }),
  );
}

async function previewFixtures(): Promise<void> {
  const fixtureRoot = new URL(
    "../../../packages/rss/test/fixtures/",
    import.meta.url,
  );
  const feed = await parsePitchforkFeed(
    await readFile(new URL("pitchfork.xml", fixtureRoot), "utf8"),
  );
  const html = await readFile(new URL("review.html", fixtureRoot), "utf8");
  const tracks = feed.entries.map((entry) =>
    extractPitchforkTrack(entry, html),
  );
  console.log(JSON.stringify({ event: "feed_parsed", level: "INFO", feed }));
  tracks.forEach(logTrack);
  console.log(
    JSON.stringify({ tracks, rejected: feed.errors.length }, null, 2),
  );
}

async function previewRegisteredSource(sourceKey: string): Promise<void> {
  validateSourceKey(sourceKey);
  if (!process.env.DATABASE_URL) {
    throw new IngestionError("DATABASE_CONFIG_MISSING");
  }
  const database = connectDatabase(process.env.DATABASE_URL, { sourceKey });
  let primaryFailure: IngestionError | undefined;
  try {
    const result = await previewSource(database.store, sourceKey);
    if (result.status === "skipped") {
      console.log(JSON.stringify(result));
      return;
    }
    console.log(
      JSON.stringify({
        event: "feed_parsed",
        level: "INFO",
        feed: result.feed,
      }),
    );
    result.tracks.forEach(logTrack);
    console.log(
      JSON.stringify(
        { tracks: result.tracks, rejected: result.feed.errors.length },
        null,
        2,
      ),
    );
  } catch (error) {
    primaryFailure = toIngestionError(error);
    throw primaryFailure;
  } finally {
    try {
      await database.close();
    } catch (error) {
      if (!primaryFailure) {
        throw error;
      }
      primaryFailure.cleanupErrors.push(errorCode(error));
    }
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.length === 1 && args[0] === "--fixture") {
    await previewFixtures();
    return;
  }
  if (args.length === 2 && args[0] === "--source") {
    await handler({ sourceKey: validateSourceKey(args[1]) });
    return;
  }
  if (args.length === 3 && args[0] === "--preview" && args[1] === "--source") {
    await previewRegisteredSource(args[2]!);
    return;
  }
  throw new IngestionError("INVALID_SOURCE");
}

main().catch((error: unknown) => {
  console.error(toIngestionError(error).message);
  console.error(
    "Usage: pnpm ingest --source <key> | pnpm ingest:preview --source <key> | pnpm ingest:fixture",
  );
  process.exitCode = 1;
});
