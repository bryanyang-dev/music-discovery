import type { Context } from "aws-lambda";
import {
  connectDatabase,
  type DatabaseLogger,
} from "../../../packages/db/src/index.ts";
import {
  IngestionError,
  toIngestionError,
  type MatchingTrack,
  type SpotifyMatch,
  type TrackMatchingStore,
} from "../../../packages/shared/src/index.ts";
import { matchTrack } from "./run.ts";
import { searchSpotify } from "./spotify/search.ts";
import { MATCHER_TIMING } from "./timing.ts";
import { parseTrackMatcherEvent } from "./event-validation.ts";
import type { TrackMatcherEvent } from "./models.ts";

type Connection = { matching: TrackMatchingStore; close(): Promise<void> };
interface Dependencies {
  connect?: (
    url: string,
    options: {
      signal: AbortSignal;
      logger: DatabaseLogger;
      requestId: string | null;
    },
  ) => Connection;
  databaseUrl?: string;
  lookup?: (track: MatchingTrack, signal: AbortSignal) => Promise<SpotifyMatch>;
  logger?: Pick<Console, "log" | "error">;
}

export function createHandler(dependencies: Dependencies = {}) {
  return async (event?: TrackMatcherEvent, context?: Context) => {
    const logger = dependencies.logger ?? console;
    const requestId = context?.awsRequestId ?? null;
    let connection: Connection | undefined;
    let failure: IngestionError | undefined;
    try {
      const { trackId } = parseTrackMatcherEvent(event);
      const workDurationMs = Math.min(
        MATCHER_TIMING.maxWorkDurationMs,
        (context?.getRemainingTimeInMillis() ?? Infinity) -
          MATCHER_TIMING.cleanupReserveMs,
      );
      if (workDurationMs <= 0) throw new IngestionError("RUN_DEADLINE");
      const signal = AbortSignal.timeout(workDurationMs);
      const databaseUrl = dependencies.databaseUrl ?? process.env.DATABASE_URL;
      if (!databaseUrl) throw new IngestionError("DATABASE_CONFIG_MISSING");
      connection = (dependencies.connect ?? connectDatabase)(databaseUrl, {
        signal,
        logger,
        requestId,
      });
      const result = await matchTrack(
        connection.matching,
        trackId,
        (track) =>
          dependencies.lookup
            ? dependencies.lookup(track, signal)
            : searchSpotify(
                track,
                {
                  clientId: process.env.SPOTIFY_CLIENT_ID ?? "",
                  clientSecret: process.env.SPOTIFY_CLIENT_SECRET ?? "",
                  market: process.env.SPOTIFY_MARKET ?? "",
                },
                signal,
              ),
        signal,
      );
      logger.log(
        JSON.stringify({
          event: "track_matching_completed",
          requestId,
          level: "INFO",
          trackId,
          status: result.status,
        }),
      );
      return result;
    } catch (error) {
      failure = toIngestionError(error);
      logger.error(
        JSON.stringify({
          event: "track_matching_failed",
          requestId,
          level: "ERROR",
          code: failure.code,
        }),
      );
      throw failure;
    } finally {
      if (connection) {
        try {
          await connection.close();
        } catch (error) {
          const cleanup = toIngestionError(error);
          logger.error(
            JSON.stringify({
              event: "database_close_failed",
              requestId,
              level: "ERROR",
              code: cleanup.code,
            }),
          );
          if (!failure) throw cleanup;
          failure.cleanupErrors.push(cleanup.code);
        }
      }
    }
  };
}

export const handler = createHandler();
