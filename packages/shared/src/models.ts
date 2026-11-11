import type { ErrorCode } from "./errors.ts";

export const MAX_RUN_ERROR_COUNT = 100;

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

export interface SourceDefinition {
  key: string;
  name: string;
  category: string;
  feedUrl: string;
}

export interface SourceRecord extends SourceDefinition {
  id: string;
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

export function emptyCounts(): RunCounts {
  return { found: 0, inserted: 0, updated: 0, unchanged: 0, rejected: 0 };
}
