export interface Track {
  /** Editorial track ID from the API. */
  readonly id: string;
  readonly title: string;
  readonly artist: string;
  /** Matched Spotify recording, for example "spotify:track:…". */
  readonly spotifyUri: string;
  /** The review that recommended the track. */
  readonly sourceUrl: string;
}

/**
 * One week's recommendations. `date` is the Monday (ISO YYYY-MM-DD, UTC) that
 * starts the week and identifies the tape. Tracks are in play order.
 */
export interface Mixtape {
  readonly date: string;
  readonly tracks: readonly Track[];
}

/** Where a tape lying on the floor sits: the cassette's centre, in artboard pixels. */
export interface FloorPosition {
  readonly x: number;
  readonly y: number;
}
