import { connectDatabase } from "@music-discovery/db";
import {
  errorCode,
  IngestionError,
  toIngestionError,
  type ErrorCode,
  type IngestionStore,
  type RunIssue,
} from "@music-discovery/shared";
import { ingestPitchfork, runFailure, type RunOutcome } from "./run.ts";
import { INGESTION_TIMING } from "./timing.ts";

interface LambdaContext {
  getRemainingTimeInMillis(): number;
}

interface Database {
  store: IngestionStore;
  close(): Promise<void>;
}

interface HandlerDependencies {
  connect?: (url: string, options: { signal: AbortSignal }) => Database;
  run?: typeof ingestPitchfork;
  log?: (message: string) => void;
  databaseUrl?: () => string | undefined;
}

type CompletionOutcome = RunOutcome | {
  status: "failed";
  errors: RunIssue[];
  cleanupErrors?: ErrorCode[];
};

function createWorkSignal(context?: LambdaContext): AbortSignal {
  const invocationTimeRemainingMs = context?.getRemainingTimeInMillis()
    ?? INGESTION_TIMING.defaultInvocationTimeoutMs;
  const availableWorkTimeMs = invocationTimeRemainingMs - INGESTION_TIMING.cleanupReserveMs;
  const workDurationMs = Math.min(INGESTION_TIMING.maxWorkDurationMs, availableWorkTimeMs);

  if (workDurationMs < INGESTION_TIMING.minimumWorkDurationMs) {
    throw new IngestionError("RUN_DEADLINE");
  }

  return AbortSignal.timeout(workDurationMs);
}

async function runAndCloseDatabase(
  database: Database,
  signal: AbortSignal,
  run: typeof ingestPitchfork,
): Promise<RunOutcome> {
  let primaryFailure: IngestionError | undefined;

  try {
    const result = await run(database.store, { signal });
    primaryFailure = runFailure(result);
    return result;
  } catch (error) {
    primaryFailure = toIngestionError(error);
    throw primaryFailure;
  } finally {
    try {
      await database.close();
    } catch (error) {
      if (primaryFailure) {
        primaryFailure.cleanupErrors.push(errorCode(error));
        throw primaryFailure;
      }
      throw toIngestionError(error);
    }
  }
}

export function createHandler(dependencies: HandlerDependencies = {}) {
  return async (_event?: unknown, context?: LambdaContext) => {
    const {
      connect = connectDatabase,
      run = ingestPitchfork,
      log = console.log,
      databaseUrl = () => process.env.DATABASE_URL,
    } = dependencies;
    const logCompletion = (outcome: CompletionOutcome) => {
      log(JSON.stringify({
        event: "ingestion_completed",
        source: "pitchfork",
        category: "best_new_track",
        ...outcome,
      }));
    };
    let completionLogged = false;

    try {
      const signal = createWorkSignal(context);
      const connectionString = databaseUrl();
      if (!connectionString) {
        throw new IngestionError("DATABASE_ERROR");
      }

      const database = connect(connectionString, { signal });
      const result = await runAndCloseDatabase(database, signal, run);

      logCompletion(result);
      completionLogged = true;
      const failure = runFailure(result);
      if (failure) {
        throw failure;
      }

      return result;
    } catch (error) {
      const failure = toIngestionError(error);
      if (!completionLogged) {
        const outcome: CompletionOutcome = {
          status: "failed",
          errors: [{ code: failure.code, sourceUrl: null }],
        };
        if (failure.cleanupErrors.length > 0) {
          outcome.cleanupErrors = failure.cleanupErrors;
        }
        logCompletion(outcome);
      }
      throw failure;
    }
  };
}

export const handler = createHandler();

