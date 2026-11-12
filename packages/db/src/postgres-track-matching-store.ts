import { and, eq, sql } from "drizzle-orm";
import {
  IngestionError,
  type MatchingTrack,
  type TrackMatchingStore,
} from "@music-discovery/shared";
import { sameTrackIdentity } from "./merge.ts";
import { tracks, trackStreamingMatches } from "./schema.ts";
import type { InTransaction, Transaction } from "./client.ts";
import type { QueryExecutor } from "./database-logging.ts";

export function createPostgresTrackMatchingStore(
  inTransaction: InTransaction,
): TrackMatchingStore {
  async function lockTrack(
    transaction: Transaction,
    query: QueryExecutor,
    expected: MatchingTrack,
  ) {
    const [current] = await query(
      "lock_matching_track",
      transaction
        .select({
          id: tracks.id,
          trackTitle: tracks.trackTitle,
          artists: tracks.artists,
        })
        .from(tracks)
        .where(eq(tracks.id, expected.id))
        .for("update"),
    );
    if (!current) {
      throw new IngestionError("TRACK_NOT_FOUND");
    }
    if (!sameTrackIdentity(current, expected)) {
      throw new IngestionError("TRACK_CHANGED");
    }
  }
  return {
    async getTrack(trackId) {
      return inTransaction("getMatchingTrack", async (transaction, query) => {
        const [track] = await query(
          "select_matching_track",
          transaction
            .select({
              id: tracks.id,
              trackTitle: tracks.trackTitle,
              artists: tracks.artists,
            })
            .from(tracks)
            .where(eq(tracks.id, trackId)),
        );
        return track ?? null;
      });
    },
    async saveMatch(track, match) {
      return inTransaction("saveSpotifyMatch", async (transaction, query) => {
        await lockTrack(transaction, query, track);
        const [existing] = await query(
          "select_existing_spotify_match",
          transaction
            .select()
            .from(trackStreamingMatches)
            .where(
              and(
                eq(trackStreamingMatches.trackId, track.id),
                eq(trackStreamingMatches.provider, "spotify"),
              ),
            ),
        );
        if (existing?.matchStatus === "matched") {
          await query(
            "refresh_spotify_attempt",
            transaction
              .update(trackStreamingMatches)
              .set({
                lastAttemptAt: sql`clock_timestamp()`,
                lastErrorCode: null,
                updatedAt: sql`clock_timestamp()`,
              })
              .where(
                and(
                  eq(trackStreamingMatches.trackId, track.id),
                  eq(trackStreamingMatches.provider, "spotify"),
                ),
              ),
          );
          return {
            status: "matched" as const,
            providerTrackId: existing.providerTrackId!,
            providerUrl: existing.providerUrl!,
            providerTitle: existing.providerTitle,
            providerArtists: existing.providerArtists,
          };
        }
        const recording =
          match.status === "matched"
            ? {
                providerTrackId: match.providerTrackId,
                providerUrl: match.providerUrl,
                providerTitle: match.providerTitle,
                providerArtists: match.providerArtists,
                matchMethod: "search" as const,
                matchedAt: sql`clock_timestamp()`,
              }
            : {
                providerTrackId: null,
                providerUrl: null,
                providerTitle: null,
                providerArtists: null,
                matchMethod: null,
                matchedAt: null,
              };
        const patch = {
          ...recording,
          matchStatus: match.status,
          uploaderName: null,
          uploaderUrl: null,
          lastAttemptAt: sql`clock_timestamp()`,
          lastErrorCode: null,
          updatedAt: sql`clock_timestamp()`,
        };
        await query(
          "upsert_spotify_match",
          transaction
            .insert(trackStreamingMatches)
            .values({ trackId: track.id, provider: "spotify", ...patch })
            .onConflictDoUpdate({
              target: [
                trackStreamingMatches.trackId,
                trackStreamingMatches.provider,
              ],
              set: patch,
            }),
        );
        return match;
      });
    },
    async recordFailure(track, code) {
      await inTransaction(
        "recordSpotifyFailure",
        async (transaction, query) => {
          await lockTrack(transaction, query, track);
          const patch = {
            lastAttemptAt: sql`clock_timestamp()`,
            lastErrorCode: code,
            updatedAt: sql`clock_timestamp()`,
          };
          await query(
            "record_spotify_failure",
            transaction
              .insert(trackStreamingMatches)
              .values({
                trackId: track.id,
                provider: "spotify",
                matchStatus: "pending",
                ...patch,
              })
              .onConflictDoUpdate({
                target: [
                  trackStreamingMatches.trackId,
                  trackStreamingMatches.provider,
                ],
                set: patch,
              }),
          );
        },
      );
    },
  };
}
