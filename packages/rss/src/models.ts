import type { CacheValidators, FeedEntry, RunIssue } from "@music-discovery/shared";

export interface HttpOptions {
  fetcher?: typeof fetch;
  signal?: AbortSignal;
  timeoutMs?: number;
  maxBytes?: number;
  attempts?: number;
  sleep?: (milliseconds: number, signal?: AbortSignal) => Promise<void>;
  now?: () => number;
}

export interface HttpResponse {
  status: number;
  body: string;
  url: string;
  etag: string | null;
  lastModified: string | null;
}

export interface ParsedFeed {
  entries: FeedEntry[];
  found: number;
  duplicates: number;
  errors: RunIssue[];
}

export type FeedResponse =
  | { notModified: true; validators: CacheValidators }
  | { notModified: false; validators: CacheValidators; feed: ParsedFeed };
