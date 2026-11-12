import type { MatchingTrack, SpotifyMatch } from "./models.ts";
import type { ErrorCode } from "./errors.ts";

export interface TrackMatchingStore {
  getTrack(trackId: string): Promise<MatchingTrack | null>;
  // Implementations lock the track and reject changed artist/title metadata.
  saveMatch(track: MatchingTrack, match: SpotifyMatch): Promise<SpotifyMatch>;
  recordFailure(track: MatchingTrack, code: ErrorCode): Promise<void>;
}
