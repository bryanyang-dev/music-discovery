import type { MatchingTrack, SpotifyMatch } from "./models.ts";
import type { ErrorCode } from "./errors.ts";

export interface TrackMatchingStore {
  /**
   * Track IDs never sent to Spotify or left `pending` by a failed attempt,
   * oldest first. Settled `not_found`/`ambiguous` results are not retried.
   */
  listTrackIdsToMatch(limit: number): Promise<string[]>;
  getTrack(trackId: string): Promise<MatchingTrack | null>;
  // Implementations lock the track and reject changed artist/title metadata.
  saveMatch(track: MatchingTrack, match: SpotifyMatch): Promise<SpotifyMatch>;
  recordFailure(track: MatchingTrack, code: ErrorCode): Promise<void>;
}
