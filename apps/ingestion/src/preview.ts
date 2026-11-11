import { getSourceAdapter, type HttpOptions, type ParsedFeed } from "@music-discovery/rss";
import { IngestionError, validateSourceKey, type IngestionStore, type TrackInput } from "@music-discovery/shared";
import { INGESTION_TIMING } from "./timing.ts";

type PreviewResult = { status: "succeeded"; feed: ParsedFeed; tracks: TrackInput[] }
  | { status: "skipped"; reason: "disabled" };

export async function previewSource(
  store: Pick<IngestionStore, "getSource">,
  sourceKey: string,
  options: HttpOptions = {},
): Promise<PreviewResult> {
  const source = await store.getSource(validateSourceKey(sourceKey));
  if (!source) {
    return { status: "skipped", reason: "disabled" };
  }
  const adapter = getSourceAdapter(source);
  const http = { ...options, signal: options.signal ?? AbortSignal.timeout(INGESTION_TIMING.maxWorkDurationMs) };
  // Preview all entries without altering the stored validators or writing run/track records.
  const response = await adapter.fetchFeed(source.feedUrl, { etag: null, lastModified: null }, http);
  if (response.notModified) {
    throw new IngestionError("INVALID_FEED");
  }
  const tracks: TrackInput[] = [];
  for (const entry of response.feed.entries) {
    tracks.push(await adapter.extractTrack(entry, http));
  }
  return { status: "succeeded", feed: response.feed, tracks };
}
