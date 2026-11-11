import {
  emptyCounts,
  errorCode,
  IngestionError,
  MAX_RUN_ERROR_COUNT,
  PITCHFORK_SOURCE_KEY,
  safeLogUrl,
  toIngestionError,
  type CacheValidators,
  type IngestionStore,
  type RunResult,
  type SourceLease,
} from "@music-discovery/shared";
import {
  extractTrack,
  fetchFeed,
  requestPitchfork,
  type HttpOptions,
  type ParsedFeed,
} from "@music-discovery/rss";
import { INGESTION_TIMING } from "./timing.ts";

export type RunOutcome = RunResult | { status: "skipped"; reason: "busy_or_disabled" };

export interface IngestionOptions {
  signal?: AbortSignal;
  http?: HttpOptions;
}

function runFailure(result: RunOutcome): IngestionError | undefined {
  if (result.status === "failed" || result.status === "partial_failure") {
    return new IngestionError(result.errors[0]?.code ?? "INVALID_ENTRY");
  }
  return undefined;
}

function assertWorkCanContinue(signal: AbortSignal): void {
  if (signal.aborted) {
    throw new IngestionError("RUN_DEADLINE");
  }
}

async function processFeedEntries(
  store: IngestionStore,
  lease: SourceLease,
  result: RunResult,
  feed: ParsedFeed,
  http: HttpOptions,
  signal: AbortSignal,
): Promise<void> {
  result.found = feed.found;
  result.rejected = feed.errors.length;
  result.errors.push(...feed.errors);
  await store.recordDiscovery(lease, result.runId, result.found, feed.errors);

  for (const entry of feed.entries) {
    assertWorkCanContinue(signal);
    let track;

    try {
      const page = await requestPitchfork(entry.sourceUrl, "review", {}, http);
      track = extractTrack(entry, page.body, page.url);
    } catch (error) {
      if (errorCode(error) === "RUN_DEADLINE") {
        throw error;
      }

      const issue = {
        code: errorCode(error, "INVALID_METADATA"),
        sourceUrl: safeLogUrl(entry.sourceUrl),
      };
      result.rejected++;
      result.errors.push(issue);
      await store.rejectEntry(lease, result.runId, issue);
      continue;
    }

    assertWorkCanContinue(signal);
    const outcome = await store.upsertTrack(lease, result.runId, track);
    result[outcome]++;
  }

  if (result.rejected > 0) {
    result.status = "partial_failure";
  }
}

async function executeRun(
  store: IngestionStore,
  lease: SourceLease,
  signal: AbortSignal,
  http: HttpOptions,
): Promise<RunResult> {
  const runId = await store.beginRun(lease);
  const result: RunResult = {
    runId,
    status: "succeeded",
    ...emptyCounts(),
    notModified: false,
    errors: [],
  };
  let validators: CacheValidators | null = null;

  try {
    assertWorkCanContinue(signal);
    const response = await fetchFeed(lease.feedUrl, {
      etag: lease.etag,
      lastModified: lease.lastModified,
    }, http);

    validators = response.validators;
    if (response.notModified) {
      result.notModified = true;
    } else {
      await processFeedEntries(store, lease, result, response.feed, http, signal);
    }
  } catch (error) {
    result.status = "failed";
    result.errors.push({ code: errorCode(error), sourceUrl: null });
  }

  result.errors = result.errors.slice(0, MAX_RUN_ERROR_COUNT);
  const successfulValidators = result.status === "succeeded" ? validators : null;
  return store.finishRun(lease, result, successfulValidators);
}

export async function ingestPitchfork(
  store: IngestionStore,
  options: IngestionOptions = {},
): Promise<RunOutcome> {
  const signal = options.signal ?? AbortSignal.timeout(INGESTION_TIMING.maxWorkDurationMs);
  const http = { ...options.http, signal };
  const lease = await store.acquireSource(PITCHFORK_SOURCE_KEY, INGESTION_TIMING.sourceLeaseSeconds);
  if (!lease) {
    return { status: "skipped", reason: "busy_or_disabled" };
  }

  let primaryFailure: IngestionError | undefined;
  try {
    const result = await executeRun(store, lease, signal, http);
    primaryFailure = runFailure(result);
    return result;
  } catch (error) {
    primaryFailure = toIngestionError(error);
    throw primaryFailure;
  } finally {
    try {
      await store.releaseSource(lease);
    } catch (error) {
      if (primaryFailure) {
        primaryFailure.cleanupErrors.push(errorCode(error));
        throw primaryFailure;
      }
      throw toIngestionError(error);
    }
  }
}
