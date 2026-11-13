import type { TapeTrack } from "./models.ts";

export interface TapeStore {
  /** Matched tracks, newest recommendation first, at most `limit` rows. */
  listMatchedTracks(limit: number): Promise<TapeTrack[]>;
}
