import { randomUUID } from "node:crypto";
import { IngestionError } from "../../../../packages/shared/src/index.ts";

import { sanitizeSpotifyResponse } from "./response-sanitization.ts";

export const SPOTIFY_HTTP_POLICY = {
  requestTimeoutMs: 10_000,
  maxResponseBytes: 512_000,
} as const;

export interface SpotifyLoggingOptions {
  logger?: Pick<Console, "log" | "error">;
  requestId?: string | null;
}

interface SpotifyCallOptions extends SpotifyLoggingOptions {
  operation: "token" | "search";
  trackId: string;
  offset?: number;
}

// All callers supply fixed Spotify endpoints. Redirects cannot forward credentials elsewhere.
export async function spotifyJson(
  fetcher: typeof fetch,
  url: string,
  init: RequestInit,
  signal: AbortSignal,
  options: SpotifyCallOptions,
): Promise<unknown> {
  const logger = options.logger ?? console;
  const callId = randomUUID();
  const startedAt = performance.now();
  let httpStatus: number | null = null;
  let responseDetails: Record<string, unknown> = {
    response: null,
    responseTruncated: false,
  };
  let httpFailure: IngestionError | undefined;
  function emit(
    level: "INFO" | "ERROR",
    event: "spotify_request" | "spotify_response",
    details: Record<string, unknown>,
  ) {
    try {
      const message = JSON.stringify({
        event,
        level,
        requestId: options.requestId ?? null,
        trackId: options.trackId,
        callId,
        operation: options.operation,
        ...(options.offset === undefined ? {} : { offset: options.offset }),
        ...details,
      });
      if (level === "ERROR") {
        logger.error(message);
      } else {
        logger.log(message);
      }
    } catch {
      // Logging must not change request results or expose raw provider data.
    }
  }
  emit("INFO", "spotify_request", {});
  const requestSignal = AbortSignal.any([
    signal,
    AbortSignal.timeout(SPOTIFY_HTTP_POLICY.requestTimeoutMs),
  ]);
  try {
    const response = await fetcher(url, {
      ...init,
      signal: requestSignal,
      redirect: "error",
    });
    httpStatus = response.status;
    if (!response.ok) {
      if (response.status === 401 || response.status === 403) {
        httpFailure = new IngestionError("SPOTIFY_AUTH_ERROR");
      } else if (response.status === 429) {
        httpFailure = new IngestionError("SPOTIFY_RATE_LIMITED");
      } else {
        httpFailure = new IngestionError("SPOTIFY_REQUEST_FAILED");
      }
    }
    const reader = response.body?.getReader();
    if (!reader) {
      throw new IngestionError("SPOTIFY_REQUEST_FAILED");
    }
    const chunks: Uint8Array[] = [];
    let bytes = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        bytes += value.byteLength;
        if (bytes > SPOTIFY_HTTP_POLICY.maxResponseBytes) {
          throw new IngestionError("RESPONSE_TOO_LARGE");
        }
        chunks.push(value);
      }
    } finally {
      try {
        await reader.cancel();
      } catch {
        // Body disposal must not replace the original read/size failure.
      }
    }
    requestSignal.throwIfAborted();
    const result: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    try {
      responseDetails = sanitizeSpotifyResponse(result, options.operation);
    } catch {
      responseDetails = {
        response: "[response unavailable]",
        responseTruncated: true,
      };
    }
    if (httpFailure) {
      throw httpFailure;
    }
    emit("INFO", "spotify_response", {
      status: "succeeded",
      httpStatus,
      durationMs: performance.now() - startedAt,
      ...responseDetails,
    });
    return result;
  } catch (error) {
    let failure: IngestionError;
    if (signal.aborted) {
      failure = new IngestionError("RUN_DEADLINE");
    } else if (httpFailure) {
      failure = httpFailure;
    } else if (error instanceof IngestionError) {
      failure = error;
    } else {
      failure = new IngestionError("SPOTIFY_REQUEST_FAILED");
    }
    emit("ERROR", "spotify_response", {
      status: "failed",
      httpStatus,
      durationMs: performance.now() - startedAt,
      ...responseDetails,
      code: failure.code,
    });
    throw failure;
  }
}
