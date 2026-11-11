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
  type SourceRecord,
  type TrackInput,
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
  fetch?: typeof fetchFeed;
  onFeedParsed?: (feed: ParsedFeed) => void;
  onTrackExtracted?: (track: TrackInput) => void;
}

async function processFeedEntries(
  store: IngestionStore,
  source: SourceRecord,
  result: RunResult,
  feed: ParsedFeed,
  http: HttpOptions,
  onTrackExtracted: (track: TrackInput) => void,
): Promise<void> {
  result.found = feed.found;
  result.rejected = feed.errors.length;
  result.errors.push(...feed.errors);
  await store.recordDiscovery(source, result.runId, feed.errors);

  for (const entry of feed.entries) {
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

    onTrackExtracted(track);
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
  http: HttpOptions,
  fetch: typeof fetchFeed,
  onFeedParsed: (feed: ParsedFeed) => void,
  onTrackExtracted: (track: TrackInput) => void,
): Promise<RunResult> {
  const runId = await store.beginRun(source);
  const result: RunResult = {
    runId,
    status: "succeeded",
    ...emptyCounts(),
    notModified: false,
    errors: [],
  };
  let primaryFailure: IngestionError | undefined;
  let validators: CacheValidators | null = null;

  try {
    const response = await fetch(source.feedUrl, {
      etag: source.etag,
      lastModified: source.lastModified,
    }, http);
    validators = response.validators;

    if (response.notModified) {
      result.notModified = true;
    } else {
      onFeedParsed(response.feed);
      await processFeedEntries(store, source, result, response.feed, http, onTrackExtracted);
    }
  } catch (error) {
    result.status = "failed";
    primaryFailure = toIngestionError(error);
    result.errors.unshift({ code: primaryFailure.code, sourceUrl: null });
  }

  result.errors = result.errors.slice(0, MAX_RUN_ERROR_COUNT);
  try {
    return await store.finishRun(source, result, result.status === "succeeded" ? validators : null);
  } catch (error) {
    if (primaryFailure) {
      primaryFailure.cleanupErrors.push(errorCode(error));
      throw primaryFailure;
    }
    throw error;
  }
}

export async function ingestPitchfork(
  store: IngestionStore,
  options: IngestionOptions = {},
): Promise<RunOutcome> {
  const signal = options.signal ?? AbortSignal.timeout(INGESTION_TIMING.maxWorkDurationMs);
  // HTTP and database operations own cancellation; finalization uses its cleanup budget.
  const http = { ...options.http, signal };
  const source = await store.getSource(PITCHFORK_SOURCE_KEY);
  if (!source) {
    return { status: "skipped", reason: "disabled" };
  }

  const onFeedParsed = options.onFeedParsed ?? ((feed: ParsedFeed) => {
    console.log(JSON.stringify({ event: "feed_parsed", level: "INFO", feed }));
  });
  const onTrackExtracted = options.onTrackExtracted ?? ((track: TrackInput) => {
    console.log(JSON.stringify({ event: "track_extracted", level: "INFO", track }));
  });
  return executeRun(store, source, http, options.fetch ?? fetchFeed, onFeedParsed, onTrackExtracted);
}
