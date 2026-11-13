import type { IncomingMessage, ServerResponse } from "node:http";
import {
  toIngestionError,
  type TapeStore,
} from "../../../packages/shared/src/index.ts";
import { groupIntoWeeklyTapes } from "./weekly-tapes.ts";

export const TAPE_API_POLICY = {
  /** Tapes shown in the box; the listening room has seven slots. */
  tapeBoxWeekCount: 7,
  /** Matched tracks read per request, newest first, before grouping into weeks. */
  maxTracksRead: 500,
} as const;

interface TapeApiDependencies {
  tapes: TapeStore;
  /** Public Spotify app client ID, used by the browser's PKCE sign-in. */
  spotifyClientId: string;
  logger?: Pick<Console, "log" | "error">;
}

function sendJson(
  response: ServerResponse,
  statusCode: number,
  body: unknown,
): void {
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  response.end(JSON.stringify(body));
}

/** Local, read-only API for the listening room. It serves no user data. */
export function createTapeApiHandler(dependencies: TapeApiDependencies) {
  const logger = dependencies.logger ?? console;
  return async (
    request: IncomingMessage,
    response: ServerResponse,
  ): Promise<void> => {
    const path = new URL(request.url ?? "/", "http://127.0.0.1").pathname;
    if (request.method !== "GET") {
      sendJson(response, 405, { code: "METHOD_NOT_ALLOWED" });
      return;
    }
    if (path === "/api/spotify-config") {
      sendJson(response, 200, { clientId: dependencies.spotifyClientId });
      return;
    }
    if (path !== "/api/tapes") {
      sendJson(response, 404, { code: "NOT_FOUND" });
      return;
    }
    try {
      const tracks = await dependencies.tapes.listMatchedTracks(
        TAPE_API_POLICY.maxTracksRead,
      );
      sendJson(response, 200, {
        tapes: groupIntoWeeklyTapes(tracks, TAPE_API_POLICY.tapeBoxWeekCount),
      });
    } catch (error) {
      const code = toIngestionError(error).code;
      logger.error(
        JSON.stringify({ event: "tape_request_failed", level: "ERROR", code }),
      );
      sendJson(response, 500, { code });
    }
  };
}
