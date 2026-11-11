import { createHash } from "node:crypto";

export const PITCHFORK_FEED_URL = "https://pitchfork.com/feed/reviews/best/tracks/rss";
export const PITCHFORK_SOURCE_KEY = "pitchfork_best_new_tracks";
export const MAX_RUN_ERROR_COUNT = 100;

export type ErrorCode =
  | "UNSAFE_URL" | "HTTP_ERROR" | "NETWORK_ERROR" | "REQUEST_TIMEOUT"
  | "RESPONSE_TOO_LARGE" | "UNSUPPORTED_ENCODING" | "INVALID_FEED"
  | "INVALID_ENTRY" | "MISSING_METADATA" | "INVALID_METADATA"
  | "DATABASE_ERROR" | "SOURCE_NOT_FOUND"
  | "RUN_DEADLINE";

export class IngestionError extends Error {
  readonly code: ErrorCode;
  readonly retryAfterMs: number | null;
  readonly cleanupErrors: ErrorCode[] = [];
  constructor(code: ErrorCode, retryAfterMs: number | null = null) {
    super(code);
    this.name = "IngestionError";
    this.code = code;
    this.retryAfterMs = retryAfterMs;
  }
}

export function errorCode(error: unknown, fallback: ErrorCode = "DATABASE_ERROR"): ErrorCode {
  return error instanceof IngestionError ? error.code : fallback;
}

export function toIngestionError(error: unknown): IngestionError {
  if (error instanceof IngestionError) {
    return error;
  }

  return new IngestionError(errorCode(error));
}

export interface FeedEntry {
  sourceUrl: string;
  sourceGuid: string | null;
  reviewTitle: string | null;
  reviewAuthor: string | null;
  reviewPublishedAt: Date | null;
  summary: string | null;
  imageUrl: string | null;
}

export interface TrackInput extends FeedEntry {
  trackTitle: string;
  artists: string[];
  genres: string[];
  labels: string[];
  releaseDate: string | null;
}

export interface SourceRecord {
  id: string;
  feedUrl: string;
  enabled: boolean;
  etag: string | null;
  lastModified: string | null;
}

export interface RunCounts {
  found: number;
  inserted: number;
  updated: number;
  unchanged: number;
  rejected: number;
}

export type RunStatus = "running" | "succeeded" | "partial_failure" | "failed";
export interface RunIssue {
  code: ErrorCode;
  sourceUrl: string | null;
}

export interface RunResult extends RunCounts {
  runId: string;
  status: Exclude<RunStatus, "running">;
  notModified: boolean;
  errors: RunIssue[];
}

export interface CacheValidators {
  etag: string | null;
  lastModified: string | null;
}

export interface IngestionStore {
  getSource(sourceKey: string): Promise<SourceRecord | null>;
  beginRun(source: SourceRecord): Promise<string>;
  recordDiscovery(source: SourceRecord, runId: string, errors: RunIssue[]): Promise<void>;
  rejectEntry(source: SourceRecord, runId: string, issue: RunIssue): Promise<void>;
  upsertTrack(source: SourceRecord, runId: string, track: TrackInput): Promise<"inserted" | "updated" | "unchanged">;
  finishRun(source: SourceRecord, result: RunResult, validators: CacheValidators | null): Promise<RunResult>;
}

export function httpUrl(value: string, base?: string): string {
  const url = new URL(value, base);
  if (!["https:", "http:"].includes(url.protocol) || url.username || url.password) {
    throw new IngestionError("UNSAFE_URL");
  }
  url.hash = "";
  return url.href;
}

export function pitchforkUrl(value: string, kind: "feed" | "review" | "artist" = "review", base?: string): string {
  let url: URL;
  try {
    url = new URL(httpUrl(value, base));
  } catch {
    throw new IngestionError("UNSAFE_URL");
  }
  if (url.protocol !== "https:" || !["pitchfork.com", "www.pitchfork.com"].includes(url.hostname) || url.port) {
    throw new IngestionError("UNSAFE_URL");
  }
  url.hostname = "pitchfork.com";
  if (/%2f|%5c|\\/i.test(url.pathname)) {
    throw new IngestionError("UNSAFE_URL");
  }
  let validPath: boolean;
  if (kind === "feed") {
    validPath = url.pathname.replace(/\/$/, "") === "/feed/reviews/best/tracks/rss";
  } else if (kind === "artist") {
    validPath = /^\/artists\/[^/]+\/$/.test(url.pathname);
  } else {
    validPath = /^\/reviews\/(?!best(?:\/|$))[^?#]+\/$/.test(url.pathname);
  }
  if (!validPath) {
    throw new IngestionError("UNSAFE_URL");
  }
  for (const key of [...url.searchParams.keys()]) {
    if (/^utm_/i.test(key) || ["fbclid", "gclid", "mc_cid", "mc_eid"].includes(key.toLowerCase())) {
      url.searchParams.delete(key);
    }
  }
  if (kind === "feed" && url.search) {
    throw new IngestionError("UNSAFE_URL");
  }
  return url.href;
}

export function safeLogUrl(value: string): string | null {
  try {
    const url = new URL(pitchforkUrl(value));
    return url.origin + url.pathname;
  } catch {
    return null;
  }
}

export function sourceKey(identity: string): string {
  return createHash("sha256").update(identity).digest("hex");
}

export function emptyCounts(): RunCounts {
  return { found: 0, inserted: 0, updated: 0, unchanged: 0, rejected: 0 };
}

