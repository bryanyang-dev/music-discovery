export interface Track {
  readonly title: string;
  readonly artist: string;
}

/** One day's recommendations. `date` is an ISO calendar date (YYYY-MM-DD) and identifies the tape. */
export interface Mixtape {
  readonly date: string;
  readonly tracks: readonly Track[];
}
