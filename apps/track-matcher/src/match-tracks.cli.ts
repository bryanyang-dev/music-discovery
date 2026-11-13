import { connectDatabase } from "../../../packages/db/src/index.ts";
import {
  errorCode,
  IngestionError,
  toIngestionError,
} from "../../../packages/shared/src/index.ts";
import { handler } from "./handler.ts";
import {
  matchPendingTracks,
  PENDING_MATCH_POLICY,
} from "./pending-track-matching.ts";

async function listTrackIdsToMatch(databaseUrl: string): Promise<string[]> {
  const database = connectDatabase(databaseUrl);
  let primaryFailure: IngestionError | undefined;
  try {
    return await database.matching.listTrackIdsToMatch(
      PENDING_MATCH_POLICY.maxTracksPerRun,
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
  if (process.argv.length > 2) {
    console.error("Usage: pnpm match");
    process.exitCode = 1;
    return;
  }
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new IngestionError("DATABASE_CONFIG_MISSING");
  }
  const trackIds = await listTrackIdsToMatch(databaseUrl);
  const summary = await matchPendingTracks(trackIds, (trackId) =>
    handler({ trackId }),
  );
  console.log(
    JSON.stringify(
      {
        event: "pending_matching_completed",
        attempted: trackIds.length,
        ...summary,
      },
      null,
      2,
    ),
  );
  if (summary.failed.length > 0) {
    process.exitCode = 1;
  }
}

main().catch((error: unknown) => {
  console.error(toIngestionError(error).message);
  console.error("Usage: pnpm match");
  process.exitCode = 1;
});
