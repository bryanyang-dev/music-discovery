import { setTimeout as delay } from "node:timers/promises";
import type { Context } from "aws-lambda";
import type { FeedFetcher, HttpOptions } from "@music-discovery/rss";
import { connectDatabase, type DatabaseLogger } from "@music-discovery/db";
import {
  IngestionError,
  validateSourceKey,
  toIngestionError,
  type IngestionStore,
} from "@music-discovery/shared";
import { ingestSource } from "./run.ts";
import { INGESTION_TIMING } from "./timing.ts";

// RSS retries share a 30-second cap inside the overall ingestion work budget.
const RSS_REQUEST_TIMEOUT_MS = 30_000;
const MAX_RETRY_COUNT = 3;
const INITIAL_RETRY_DELAY_MS = 1_000;
const RETRY_BACKOFF_MULTIPLIER = 2;

type DatabaseConnection = { store: IngestionStore; close(): Promise<void> };

function createWorkSignal(context?: Context): AbortSignal {
  const workDurationMs = Math.min(
    INGESTION_TIMING.maxWorkDurationMs,
    (context?.getRemainingTimeInMillis() ?? Infinity) -
      INGESTION_TIMING.cleanupReserveMs,
  );
  if (workDurationMs <= 0) {
    throw new IngestionError("RUN_DEADLINE");
  }
  return AbortSignal.timeout(workDurationMs);
}

type RssLogger = Pick<Console, "log" | "warn" | "error">;
const LOG_LEVEL = {
  INFO: "INFO",
  WARN: "WARN",
  ERROR: "ERROR",
} as const;

type LogLevel = (typeof LOG_LEVEL)[keyof typeof LOG_LEVEL];

interface RssHandlerDependencies {
  fetch?: FeedFetcher;
  connect?: (
    url: string,
    options: {
      signal: AbortSignal;
      logger: DatabaseLogger;
      requestId: string | null;
      sourceKey: string;
    },
  ) => DatabaseConnection;
  databaseUrl?: string;
  http?: HttpOptions;
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

function createFeedFetcher(
  fetch: FeedFetcher,
  dependencies: RssHandlerDependencies,
  requestId: string | null,
): FeedFetcher {
  return async (url, validators, options) => {
    const {
      logger = console,
      sleep = (delayMs, signal) => delay(delayMs, undefined, { signal }),
    } = dependencies;
    let attempt = 0;

    try {
      const timeout = AbortSignal.timeout(RSS_REQUEST_TIMEOUT_MS);
      const signal = options?.signal
        ? AbortSignal.any([options.signal, timeout])
        : timeout;
      while (true) {
        if (signal.aborted) {
          throw new IngestionError("RUN_DEADLINE");
        }
        attempt++;
        logEvent(logger, requestId, LOG_LEVEL.INFO, "rss_fetch_started", {
          attempt,
        });

        try {
          // The handler owns retries; disable the HTTP layer's retry loop.
          const response = await fetch(url, validators, {
            ...options,
            signal,
            attempts: 1,
          });
          if (signal.aborted) {
            throw new IngestionError("RUN_DEADLINE");
          }
          logEvent(logger, requestId, LOG_LEVEL.INFO, "rss_fetch_succeeded", {
            attempt,
            response,
          });
          return response;
        } catch (error) {
          let failure =
            error instanceof IngestionError
              ? error
              : new IngestionError("HTTP_ERROR");
          if (signal.aborted) {
            failure = new IngestionError("RUN_DEADLINE");
          }
          logEvent(
            logger,
            requestId,
            LOG_LEVEL.WARN,
            "rss_fetch_attempt_failed",
            {
              attempt,
              code: failure.code,
              message: failure.message,
            },
          );

          // HTTP marks transient status/network failures with retryAfterMs.
          const retryable =
            failure.retryAfterMs !== null &&
            ["HTTP_ERROR", "NETWORK_ERROR", "REQUEST_TIMEOUT"].includes(
              failure.code,
            );
          if (!retryable) {
            throw failure;
          }
          if (attempt > MAX_RETRY_COUNT) {
            logEvent(
              logger,
              requestId,
              LOG_LEVEL.ERROR,
              "rss_fetch_max_attempts_reached",
              {
                attempt,
                maxAttempts: MAX_RETRY_COUNT + 1,
                code: failure.code,
                message: failure.message,
              },
            );
            throw failure;
          }

          const backoffMs =
            INITIAL_RETRY_DELAY_MS * RETRY_BACKOFF_MULTIPLIER ** (attempt - 1);
          const retryDelayMs = Math.max(backoffMs, failure.retryAfterMs ?? 0);
          logEvent(
            logger,
            requestId,
            LOG_LEVEL.WARN,
            "rss_fetch_retry_scheduled",
            {
              attempt,
              nextAttempt: attempt + 1,
              retryDelayMs,
            },
          );
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
      const failure =
        error instanceof IngestionError
          ? error
          : new IngestionError("HTTP_ERROR");
      if (failure.code === "RUN_DEADLINE") {
        logEvent(logger, requestId, LOG_LEVEL.ERROR, "rss_fetch_aborted", {
          attempt,
          code: failure.code,
          message: failure.message,
        });
      }
      logEvent(logger, requestId, LOG_LEVEL.ERROR, "rss_fetch_failed", {
        attempt,
        code: failure.code,
        message: failure.message,
      });
      throw failure;
    }
  };
}

export function sourceKeyFromEvent(event: unknown): string {
  if (
    event === null ||
    typeof event !== "object" ||
    Array.isArray(event) ||
    !Object.hasOwn(event, "sourceKey")
  ) {
    throw new IngestionError("INVALID_SOURCE");
  }
  return validateSourceKey((event as { sourceKey: unknown }).sourceKey);
}

export function createHandler(dependencies: RssHandlerDependencies = {}) {
  return async (event?: unknown, context?: Context) => {
    const logger = dependencies.logger ?? console;
    const requestId = context?.awsRequestId ?? null;
    let database: DatabaseConnection | undefined;
    let failure: IngestionError | undefined;
    try {
      const sourceKey = sourceKeyFromEvent(event);
      const signal = createWorkSignal(context);
      const databaseUrl = dependencies.databaseUrl ?? process.env.DATABASE_URL;
      if (!databaseUrl) {
        throw new IngestionError("DATABASE_CONFIG_MISSING");
      }
      database = (dependencies.connect ?? connectDatabase)(databaseUrl, {
        signal,
        logger,
        requestId,
        sourceKey,
      });
      const result = await ingestSource(database.store, sourceKey, {
        http: dependencies.http ?? {},
        signal,
        wrapFetch: (fetch) =>
          createFeedFetcher(
            dependencies.fetch ?? fetch,
            dependencies,
            requestId,
          ),
        onFeedParsed: (feed) => {
          logEvent(logger, requestId, LOG_LEVEL.INFO, "feed_parsed", { feed });
        },
        onTrackExtracted: (track) => {
          logEvent(logger, requestId, LOG_LEVEL.INFO, "track_extracted", {
            track,
          });
        },
      });
      logEvent(
        logger,
        requestId,
        result.status === "succeeded" || result.status === "skipped"
          ? LOG_LEVEL.INFO
          : LOG_LEVEL.ERROR,
        "ingestion_completed",
        { sourceKey, result },
      );
      if (result.status === "failed") {
        throw new IngestionError(result.errors[0]?.code ?? "DATABASE_ERROR");
      }
      return result;
    } catch (error) {
      failure = toIngestionError(error);
      logEvent(logger, requestId, LOG_LEVEL.ERROR, "ingestion_failed", {
        code: failure.code,
        message: failure.message,
      });
      throw failure;
    } finally {
      if (database) {
        try {
          await database.close();
        } catch (error) {
          const cleanupFailure = toIngestionError(error);
          logEvent(
            logger,
            requestId,
            LOG_LEVEL.ERROR,
            "database_close_failed",
            {
              code: cleanupFailure.code,
              message: cleanupFailure.message,
            },
          );
          if (!failure) {
            throw cleanupFailure;
          }
          failure.cleanupErrors.push(cleanupFailure.code);
        }
      }
    }
  };
}

export const handler = createHandler();
