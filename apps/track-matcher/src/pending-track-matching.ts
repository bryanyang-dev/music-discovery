import {
  toIngestionError,
  type ErrorCode,
} from "../../../packages/shared/src/index.ts";

export const PENDING_MATCH_POLICY = {
  /** Upper bound on tracks matched by one local run; rerun to continue. */
  maxTracksPerRun: 200,
} as const;

export interface PendingMatchSummary {
  matched: number;
  notFound: number;
  ambiguous: number;
  failed: { trackId: string; code: ErrorCode }[];
}

/**
 * Matches each listed track in turn. A failed track is recorded and skipped so
 * one Spotify or database error does not stop the rest of the run.
 */
export async function matchPendingTracks(
  trackIds: readonly string[],
  matchOne: (trackId: string) => Promise<{ status: string }>,
): Promise<PendingMatchSummary> {
  const summary: PendingMatchSummary = {
    matched: 0,
    notFound: 0,
    ambiguous: 0,
    failed: [],
  };
  for (const trackId of trackIds) {
    try {
      const { status } = await matchOne(trackId);
      if (status === "matched") {
        summary.matched += 1;
      } else if (status === "ambiguous") {
        summary.ambiguous += 1;
      } else {
        summary.notFound += 1;
      }
    } catch (error) {
      summary.failed.push({ trackId, code: toIngestionError(error).code });
    }
  }
  return summary;
}
