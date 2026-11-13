import { findLoadedTape, type MixtapeSession } from "./mixtape-session.ts";

/** What the Spotify player should do in response to a cassette key. */
export type PlaybackCommand =
  | { readonly kind: "none" }
  | { readonly kind: "toggle" }
  | { readonly kind: "next" }
  | { readonly kind: "previous" }
  | {
      readonly kind: "start";
      readonly uris: readonly string[];
      readonly offset: number;
    };

function isOnLoadedTape(
  session: MixtapeSession,
  spotifyTrackUri: string | null,
): boolean {
  const tape = findLoadedTape(session);
  return (
    tape !== null &&
    spotifyTrackUri !== null &&
    tape.tracks.some((track) => track.spotifyUri === spotifyTrackUri)
  );
}

/**
 * Play/pause: if Spotify is already on this tape, toggle it; otherwise start the
 * tape from the selected track.
 */
export function planTogglePlayback(
  session: MixtapeSession,
  spotifyTrackUri: string | null,
): PlaybackCommand {
  const tape = findLoadedTape(session);
  if (!tape) {
    return { kind: "none" };
  }
  if (isOnLoadedTape(session, spotifyTrackUri)) {
    return { kind: "toggle" };
  }
  return {
    kind: "start",
    uris: tape.tracks.map((track) => track.spotifyUri),
    offset: session.trackIndex,
  };
}

/**
 * Next/previous: Spotify skips when it is on this tape. Otherwise nothing is
 * sent and the session only moves the selected track.
 */
export function planSkip(
  session: MixtapeSession,
  spotifyTrackUri: string | null,
  direction: "next" | "previous",
): PlaybackCommand {
  if (!isOnLoadedTape(session, spotifyTrackUri)) {
    return { kind: "none" };
  }
  return { kind: direction };
}
