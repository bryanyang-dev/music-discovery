import type {
  CacheValidators,
  FeedEntry,
  SourceDefinition,
  TrackInput,
} from "@music-discovery/shared";
import type { HttpOptions, FeedResponse } from "./models.ts";

export type FeedFetcher = (
  url: string,
  validators: CacheValidators,
  options?: HttpOptions,
) => Promise<FeedResponse>;

export interface SourceAdapter {
  validateSource(source: SourceDefinition): void;
  fetchFeed: FeedFetcher;
  extractTrack(entry: FeedEntry, options: HttpOptions): Promise<TrackInput>;
}
