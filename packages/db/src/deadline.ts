import { IngestionError, type ErrorCode } from "@music-discovery/shared";
import { DATABASE_POLICY } from "./policy.ts";

const MILLISECONDS_PER_SECOND = 1_000;

interface DatabaseDeadlineOptions {
  timeoutMs?: number;
  signal?: AbortSignal;
}

export function boundDatabaseOperation<Result>(
  operation: () => Promise<Result>,
  terminate: () => Promise<void>,
  options: DatabaseDeadlineOptions = {},
): Promise<Result> {
  return new Promise<Result>((resolve, reject) => {
    let finished = false;

    const clearDeadline = () => {
      clearTimeout(operationTimer);
      options.signal?.removeEventListener("abort", onAbort);
    };

    const stop = (code: ErrorCode) => {
      if (finished) {
        return;
      }
      finished = true;
      clearDeadline();

      const failure = new IngestionError(code);
      const terminationTimeoutMs = DATABASE_POLICY.closeTimeoutSeconds * MILLISECONDS_PER_SECOND;
      const terminationTimer = setTimeout(() => reject(failure), terminationTimeoutMs);
      const finishTermination = () => {
        clearTimeout(terminationTimer);
        reject(failure);
      };
      Promise.resolve().then(terminate).then(finishTermination, finishTermination);
    };

    const onAbort = () => stop("RUN_DEADLINE");
    const operationTimeoutMs = options.timeoutMs ?? DATABASE_POLICY.operationTimeoutMs;
    const operationTimer = setTimeout(() => stop("DATABASE_ERROR"), operationTimeoutMs);
    options.signal?.addEventListener("abort", onAbort, { once: true });

    if (options.signal?.aborted) {
      onAbort();
      return;
    }

    Promise.resolve().then(async () => {
      if (finished) {
        return;
      }

      try {
        const result = await operation();
        if (finished) {
          return;
        }
        finished = true;
        clearDeadline();
        resolve(result);
      } catch (error) {
        if (finished) {
          return;
        }
        finished = true;
        clearDeadline();
        reject(error);
      }
    });
  });
}

