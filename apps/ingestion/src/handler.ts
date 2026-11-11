import { setTimeout as delay } from "node:timers/promises";
import type { Context } from "aws-lambda";
import { fetchFeed } from "@music-discovery/rss";
import { IngestionError, PITCHFORK_FEED_URL } from "@music-discovery/shared";

// Bound the entire RSS fetch, including retries. Leave a small margin to log/return
// before Lambda terminates the invocation; no database cleanup is needed here.
const RSS_REQUEST_TIMEOUT_MS = 30_000;
const RESPONSE_RESERVE_MS = 250;
const MAX_RETRY_COUNT = 3;
const INITIAL_RETRY_DELAY_MS = 1_000;
const RETRY_BACKOFF_MULTIPLIER = 2;

function createRssSignal(context?: Context): AbortSignal {
  let requestTimeoutMs = RSS_REQUEST_TIMEOUT_MS;
  if (context) {
    requestTimeoutMs = Math.min(
      requestTimeoutMs,
      context.getRemainingTimeInMillis() - RESPONSE_RESERVE_MS,
    );
  }
  if (requestTimeoutMs <= 0) {
    throw new IngestionError("RUN_DEADLINE");
  }
  return AbortSignal.timeout(requestTimeoutMs);
}

type RssLogger = Pick<Console, "log" | "warn" | "error">;
const LOG_LEVEL = {
  INFO: "INFO",
  WARN: "WARN",
  ERROR: "ERROR",
} as const;

type LogLevel = typeof LOG_LEVEL[keyof typeof LOG_LEVEL];

interface RssHandlerDependencies {
  fetch?: typeof fetchFeed;
  logger?: RssLogger;
  sleep?: (delayMs: number, signal: AbortSignal) => Promise<void>;
}

function logEvent(
  logger: RssLogger,
  requestId: string | null,
  level: LogLevel,
  event: string,
  details: Record<string, unknown>,
): void {
  const message = JSON.stringify({ event, requestId, ...details, level });
  if (level === LOG_LEVEL.ERROR) {
    logger.error(message);
  } else if (level === LOG_LEVEL.WARN) {
    logger.warn(message);
  } else {
    logger.log(message);
  }
}

export function createHandler(dependencies: RssHandlerDependencies = {}) {
  return async (_event?: unknown, context?: Context) => {
    const {
      fetch = fetchFeed,
      logger = console,
      sleep = (delayMs, signal) => delay(delayMs, undefined, { signal }),
    } = dependencies;
    const requestId = context?.awsRequestId ?? null;
    let attempt = 0;

    try {
      const signal = createRssSignal(context);
      while (true) {
        if (signal.aborted) {
          throw new IngestionError("RUN_DEADLINE");
        }
        attempt++;
        logEvent(logger, requestId, LOG_LEVEL.INFO, "rss_fetch_started", { attempt });

        try {
          // The handler owns retries; disable the HTTP layer's retry loop.
          const response = await fetch(
            PITCHFORK_FEED_URL,
            { etag: null, lastModified: null },
            { signal, attempts: 1 },
          );
          if (signal.aborted) {
            throw new IngestionError("RUN_DEADLINE");
          }
          logEvent(logger, requestId, LOG_LEVEL.INFO, "rss_fetch_succeeded", {
            attempt,
            response,
          });
          return response;
        } catch (error) {
          let failure = error instanceof IngestionError
            ? error
            : new IngestionError("HTTP_ERROR");
          if (signal.aborted) {
            failure = new IngestionError("RUN_DEADLINE");
          }
          logEvent(logger, requestId, LOG_LEVEL.WARN, "rss_fetch_attempt_failed", {
            attempt,
            code: failure.code,
          });

          // HTTP marks transient status/network failures with retryAfterMs.
          const retryable = failure.retryAfterMs !== null
            && ["HTTP_ERROR", "NETWORK_ERROR", "REQUEST_TIMEOUT"].includes(failure.code);
          if (!retryable) {
            throw failure;
          }
          if (attempt > MAX_RETRY_COUNT) {
            logEvent(logger, requestId, LOG_LEVEL.ERROR, "rss_fetch_max_attempts_reached", {
              attempt,
              maxAttempts: MAX_RETRY_COUNT + 1,
              code: failure.code,
            });
            throw failure;
          }

          const backoffMs = INITIAL_RETRY_DELAY_MS * RETRY_BACKOFF_MULTIPLIER ** (attempt - 1);
          const retryDelayMs = Math.max(backoffMs, failure.retryAfterMs ?? 0);
          logEvent(logger, requestId, LOG_LEVEL.WARN, "rss_fetch_retry_scheduled", {
            attempt,
            nextAttempt: attempt + 1,
            retryDelayMs,
          });
          try {
            await sleep(retryDelayMs, signal);
          } catch {
            if (signal.aborted) {
              throw new IngestionError("RUN_DEADLINE");
            }
            throw failure;
          }
        }
      }
    } catch (error) {
      const failure = error instanceof IngestionError
        ? error
        : new IngestionError("HTTP_ERROR");
      if (failure.code === "RUN_DEADLINE") {
        logEvent(logger, requestId, LOG_LEVEL.ERROR, "rss_fetch_aborted", { attempt, code: failure.code });
      }
      logEvent(logger, requestId, LOG_LEVEL.ERROR, "rss_fetch_failed", { attempt, code: failure.code });
      throw failure;
    }
  };
}

export const handler = createHandler();
