import { createHash } from "node:crypto";

export const PITCHFORK_FEED_URL = "https://pitchfork.com/feed/reviews/best/tracks/rss";
export const PITCHFORK_SOURCE_KEY = "pitchfork_best_new_tracks";
export const MAX_RUN_ERROR_COUNT = 100;

// Messages are fixed application text; never interpolate URLs, SQL or driver messages.
export const INGESTION_ERROR_MESSAGES = {
  UNSAFE_URL: "The URL is not an allowed Pitchfork URL or contains credentials.",
  HTTP_ERROR: "Pitchfork returned an unsuccessful HTTP response.",
  NETWORK_ERROR: "The request to Pitchfork failed due to a network error.",
  REQUEST_TIMEOUT: "The request to Pitchfork exceeded its time limit.",
  RESPONSE_TOO_LARGE: "The response exceeded the allowed decompressed size.",
  UNSUPPORTED_ENCODING: "The feed or response uses an unsupported text encoding.",
  INVALID_FEED: "The response is not a valid Pitchfork Best New Tracks RSS feed.",
  INVALID_ENTRY: "The feed entry or track is missing required fields or contains invalid values.",
  MISSING_METADATA: "The review is missing the track title or artist metadata.",
  INVALID_METADATA: "The review metadata is invalid or does not match this track review.",
  DATABASE_ERROR: "The database operation failed for an unclassified reason. Check database diagnostics.",
  DATABASE_CONFIG_MISSING: "DATABASE_URL is missing or empty in the runtime environment.",
  DATABASE_CONFIG_INVALID: "DATABASE_URL must be a valid PostgreSQL connection URL; local TLS bypass is allowed only on loopback.",
  DATABASE_TLS_ERROR: "Database TLS verification failed. Check the server certificate and NODE_EXTRA_CA_CERTS trusted CA file.",
  DATABASE_AUTH_ERROR: "Database authentication failed. Check the runtime database username and password.",
  DATABASE_PERMISSION_ERROR: "The database role lacks permission for this operation. Check table grants and row-level security policies.",
  DATABASE_DNS_ERROR: "The database hostname could not be resolved. Check DATABASE_URL and DNS connectivity.",
  DATABASE_CONNECTION_ERROR: "The database connection failed or was closed. Check the host, port, database availability and network access.",
  DATABASE_TIMEOUT: "A database connection, query or lock exceeded its time limit, or the server canceled the query.",
  DATABASE_SCHEMA_ERROR: "The configured database, schema, table or column does not exist. Check the database target and applied migrations.",
  SOURCE_NOT_FOUND: "The Pitchfork ingestion source is missing from the database. Check the source seed migration.",
  RUN_DEADLINE: "The ingestion work deadline was reached; processing stopped to leave time for cleanup.",
} as const;

export type ErrorCode = keyof typeof INGESTION_ERROR_MESSAGES;

export class IngestionError extends Error {
  readonly code: ErrorCode;
  readonly retryAfterMs: number | null;
  readonly cleanupErrors: ErrorCode[] = [];
  constructor(code: ErrorCode, retryAfterMs: number | null = null) {
    super(`${code}: ${INGESTION_ERROR_MESSAGES[code]}`);
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

