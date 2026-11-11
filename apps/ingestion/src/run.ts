import {
  emptyCounts,
  errorCode,
  IngestionError,
  MAX_RUN_ERROR_COUNT,
  PITCHFORK_SOURCE_KEY,
  safeLogUrl,
  type CacheValidators,
  type IngestionStore,
  type RunResult,
  type SourceRecord,
} from "@music-discovery/shared";
import {
  extractTrack,
  fetchFeed,
  requestPitchfork,
  type HttpOptions,
  type ParsedFeed,
} from "@music-discovery/rss";
import { INGESTION_TIMING } from "./timing.ts";

export type RunOutcome = RunResult | { status: "skipped"; reason: "disabled" };

export interface IngestionOptions {
  signal?: AbortSignal;
  http?: HttpOptions;
}

function assertWorkCanContinue(signal: AbortSignal): void {
  if (signal.aborted) {
    throw new IngestionError("RUN_DEADLINE");
  }
}

async function processFeedEntries(
  store: IngestionStore,
  source: SourceRecord,
  result: RunResult,
  feed: ParsedFeed,
  http: HttpOptions,
  signal: AbortSignal,
): Promise<void> {
  result.found = feed.found;
  result.rejected = feed.errors.length;
  result.errors.push(...feed.errors);
  await store.recordDiscovery(source, result.runId, feed.errors);

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
      await store.rejectEntry(source, result.runId, issue);
      continue;
    }

    assertWorkCanContinue(signal);
    const outcome = await store.upsertTrack(source, result.runId, track);
    result[outcome]++;
  }

  if (result.rejected > 0) {
    result.status = "partial_failure";
  }
}

async function executeRun(
  store: IngestionStore,
  source: SourceRecord,
  signal: AbortSignal,
  http: HttpOptions,
): Promise<RunResult> {
  const runId = await store.beginRun(source);
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
    const response = await fetchFeed(source.feedUrl, {
      etag: source.etag,
      lastModified: source.lastModified,
    }, http);

    validators = response.validators;
    if (response.notModified) {
      result.notModified = true;
    } else {
      await processFeedEntries(store, source, result, response.feed, http, signal);
    }
  } catch (error) {
    result.status = "failed";
    result.errors.push({ code: errorCode(error), sourceUrl: null });
  }

  result.errors = result.errors.slice(0, MAX_RUN_ERROR_COUNT);
  const successfulValidators = result.status === "succeeded" ? validators : null;
  return store.finishRun(source, result, successfulValidators);
}

export async function ingestPitchfork(
  store: IngestionStore,
  options: IngestionOptions = {},
): Promise<RunOutcome> {
  const signal = options.signal ?? AbortSignal.timeout(INGESTION_TIMING.maxWorkDurationMs);
  const http = { ...options.http, signal };
  const source = await store.getSource(PITCHFORK_SOURCE_KEY);
  if (!source) {
    return { status: "skipped", reason: "disabled" };
  }

  return executeRun(store, source, signal, http);
}
