import {
  IngestionError,
  toIngestionError,
  type MatchingTrack,
  type SpotifyMatch,
  type TrackMatchingStore,
} from "../../../packages/shared/src/index.ts";

export async function matchTrack(
  store: TrackMatchingStore,
  trackId: string,
  lookup: (track: MatchingTrack) => Promise<SpotifyMatch>,
  signal: AbortSignal,
) {
  const track = await store.getTrack(trackId);
  if (!track) throw new IngestionError("TRACK_NOT_FOUND");
  let match: SpotifyMatch;
  try {
    match = await lookup(track);
    signal.throwIfAborted();
  } catch (error) {
    const failure = signal.aborted
      ? new IngestionError("RUN_DEADLINE")
      : toIngestionError(error);
    if (!signal.aborted) {
      try {
        await store.recordFailure(track, failure.code);
      } catch (recordError) {
        failure.cleanupErrors.push(toIngestionError(recordError).code);
      }
    }
    throw failure;
  }
  const saved = await store.saveMatch(track, match);
  return { trackId, provider: "spotify" as const, ...saved };
}
