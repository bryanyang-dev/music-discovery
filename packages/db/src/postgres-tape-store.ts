import { and, desc, eq, sql } from "drizzle-orm";
import type { TapeStore } from "@music-discovery/shared";
import { tracks, trackStreamingMatches } from "./schema.ts";
import type { InTransaction } from "./client.ts";

export function createPostgresTapeStore(
  inTransaction: InTransaction,
): TapeStore {
  return {
    async listMatchedTracks(limit) {
      return inTransaction("listMatchedTracks", async (transaction, query) => {
        const recommendedAt = sql<Date>`coalesce(${tracks.reviewPublishedAt}, ${tracks.firstSeenAt})`;
        // Aliases reuse names already allowlisted by the response log sanitizer.
        const rows = await query(
          "select_matched_tracks",
          transaction
            .select({
              id: tracks.id,
              trackTitle: tracks.trackTitle,
              artists: tracks.artists,
              sourceUrl: tracks.sourceUrl,
              reviewPublishedAt: tracks.reviewPublishedAt,
              firstSeenAt: tracks.firstSeenAt,
              providerTrackId: trackStreamingMatches.providerTrackId,
            })
            .from(tracks)
            .innerJoin(
              trackStreamingMatches,
              and(
                eq(trackStreamingMatches.trackId, tracks.id),
                eq(trackStreamingMatches.provider, "spotify"),
                eq(trackStreamingMatches.matchStatus, "matched"),
              ),
            )
            .orderBy(desc(recommendedAt), desc(tracks.id))
            .limit(limit),
        );
        return rows.flatMap((row) =>
          row.providerTrackId === null
            ? []
            : [
                {
                  id: row.id,
                  trackTitle: row.trackTitle,
                  artists: row.artists,
                  sourceUrl: row.sourceUrl,
                  recommendedAt: row.reviewPublishedAt ?? row.firstSeenAt,
                  providerTrackId: row.providerTrackId,
                },
              ],
        );
      });
    },
  };
}
