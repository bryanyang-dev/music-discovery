/** Payload for direct invocation of the track-matcher Lambda. */
export interface TrackMatcherEvent {
  /** UUID of an existing editorial track in the database. */
  trackId: string;
}
