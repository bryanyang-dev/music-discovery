import type { CacheValidators, RunIssue, RunResult, SourceRecord, TrackInput } from "./models.ts";

export interface IngestionStore {
  getSource(sourceKey: string): Promise<SourceRecord | null>;
  beginRun(source: SourceRecord): Promise<string>;
  recordDiscovery(source: SourceRecord, runId: string, errors: RunIssue[]): Promise<void>;
  rejectEntry(source: SourceRecord, runId: string, issue: RunIssue): Promise<void>;
  upsertTrack(source: SourceRecord, runId: string, track: TrackInput): Promise<"inserted" | "updated" | "unchanged">;
  finishRun(source: SourceRecord, result: RunResult, validators: CacheValidators | null): Promise<RunResult>;
}
