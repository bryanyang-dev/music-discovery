import { randomUUID } from "node:crypto";
import { databaseError } from "./errors.ts";
import { sanitizeDatabaseResponse } from "./database-response-sanitization.ts";

export type DatabaseLogger = Pick<Console, "log" | "error">;

export interface DatabaseLoggingOptions {
  logger?: DatabaseLogger;
  requestId?: string | null;
  sourceKey?: string;
}

type DatabaseCallScope = "transaction" | "query" | "connection";

interface DatabaseCall {
  scope: DatabaseCallScope;
  operation: string;
  parentCallId?: string;
}

function responseSummary(result: unknown): Record<string, unknown> {
  if (Array.isArray(result)) {
    const count = (result as unknown as { count?: unknown }).count;
    return {
      rowCount: result.length,
      ...(typeof count === "number" && Number.isFinite(count)
        ? { affectedRowCount: count }
        : {}),
    };
  }
  if (result === "inserted" || result === "updated" || result === "unchanged") {
    return { outcome: result };
  }
  return { hasResult: result !== undefined && result !== null };
}

export function createDatabaseCallLogger(options: DatabaseLoggingOptions = {}) {
  const logger = options.logger ?? console;

  function emit(
    level: "INFO" | "ERROR",
    event: string,
    details: Record<string, unknown>,
  ): void {
    // Only operational metadata and allowlisted sanitized response fields are serialized.
    try {
      const message = JSON.stringify({
        event,
        level,
        requestId: options.requestId ?? null,
        ...(options.sourceKey === undefined
          ? {}
          : { sourceKey: options.sourceKey }),
        ...details,
      });
      if (level === "ERROR") {
        logger.error(message);
      } else {
        logger.log(message);
      }
    } catch {
      // Logging must not change transaction results or prevent cleanup.
    }
  }

  return async function logDatabaseCall<Result>(
    call: DatabaseCall,
    execute: (callId: string) => PromiseLike<Result>,
  ): Promise<Result> {
    const callId = randomUUID();
    const startedAt = performance.now();
    const details = { callId, ...call };
    emit("INFO", "database_request", details);
    try {
      const result = await execute(callId);
      let response: Record<string, unknown>;
      try {
        response = {
          ...responseSummary(result),
          ...sanitizeDatabaseResponse(call.operation, result),
        };
      } catch {
        response = {
          response: "[response unavailable]",
          responseTruncated: true,
        };
      }
      emit("INFO", "database_response", {
        ...details,
        status: "succeeded",
        durationMs: performance.now() - startedAt,
        ...response,
      });
      return result;
    } catch (error) {
      const failure = databaseError(error);
      emit("ERROR", "database_response", {
        ...details,
        status: "failed",
        durationMs: performance.now() - startedAt,
        code: failure.code,
        message: failure.message,
      });
      throw error;
    }
  };
}

export type QueryExecutor = <Result>(
  operation: string,
  query: PromiseLike<Result>,
) => Promise<Result>;
