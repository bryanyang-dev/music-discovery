import type { FloorPosition, Mixtape } from "./models.ts";

/**
 * What the player is doing and where each tape is. A tape is in the player
 * (`loadedTapeDate`), lying on the floor (`floorTapes`), or otherwise in the box.
 * Before Spotify is connected playback is visual only; once connected,
 * `playbackChanged` makes the session follow the Spotify player.
 */
export interface MixtapeSession {
  readonly tapes: readonly Mixtape[];
  readonly loadedTapeDate: string | null;
  /** Tapes left on the floor, keyed by tape week. */
  readonly floorTapes: Readonly<Record<string, FloorPosition>>;
  readonly trackIndex: number;
  readonly playing: boolean;
}

export type MixtapeSessionAction =
  /** The tapes arrived (or changed): start over with the newest tape loaded. */
  | { readonly type: "tapesLoaded"; readonly tapes: readonly Mixtape[] }
  | { readonly type: "loadTape"; readonly date: string }
  | { readonly type: "ejectTape" }
  | {
      readonly type: "placeTapeOnFloor";
      readonly date: string;
      readonly position: FloorPosition;
    }
  | { readonly type: "returnTapeToBox"; readonly date: string }
  | { readonly type: "togglePlayback" }
  | { readonly type: "stop" }
  | { readonly type: "nextTrack" }
  | { readonly type: "previousTrack" }
  | {
      /** Spotify player state: the current track (null when idle) and whether it is paused. */
      readonly type: "playbackChanged";
      readonly trackUri: string | null;
      readonly paused: boolean;
    };

/** Starts with the newest tape (the first one) in the player, stopped, and the rest in the box. */
export function createMixtapeSession(
  tapes: readonly Mixtape[],
): MixtapeSession {
  return {
    tapes,
    loadedTapeDate: tapes[0]?.date ?? null,
    floorTapes: {},
    trackIndex: 0,
    playing: false,
  };
}

export function findLoadedTape(session: MixtapeSession): Mixtape | null {
  if (session.loadedTapeDate === null) {
    return null;
  }
  return (
    session.tapes.find((tape) => tape.date === session.loadedTapeDate) ?? null
  );
}

function isKnownTape(session: MixtapeSession, date: string): boolean {
  return session.tapes.some((tape) => tape.date === date);
}

function withoutFloorTape(
  floorTapes: Readonly<Record<string, FloorPosition>>,
  date: string,
): Readonly<Record<string, FloorPosition>> {
  if (!(date in floorTapes)) {
    return floorTapes;
  }
  const { [date]: _removed, ...remaining } = floorTapes;
  return remaining;
}

function moveTrack(session: MixtapeSession, step: number): MixtapeSession {
  const tape = findLoadedTape(session);
  if (!tape) {
    return session;
  }
  const lastTrackIndex = tape.tracks.length - 1;
  const trackIndex = Math.min(
    Math.max(session.trackIndex + step, 0),
    lastTrackIndex,
  );
  if (trackIndex === session.trackIndex) {
    return session;
  }
  return { ...session, trackIndex };
}

export function reduceMixtapeSession(
  session: MixtapeSession,
  action: MixtapeSessionAction,
): MixtapeSession {
  switch (action.type) {
    case "tapesLoaded": {
      return action.tapes === session.tapes
        ? session
        : createMixtapeSession(action.tapes);
    }
    case "loadTape": {
      if (
        !isKnownTape(session, action.date) ||
        action.date === session.loadedTapeDate
      ) {
        return session;
      }
      // The tape that was in the player goes back to the box.
      return {
        ...session,
        loadedTapeDate: action.date,
        floorTapes: withoutFloorTape(session.floorTapes, action.date),
        trackIndex: 0,
        playing: false,
      };
    }
    case "ejectTape": {
      if (session.loadedTapeDate === null) {
        return session;
      }
      return {
        ...session,
        loadedTapeDate: null,
        trackIndex: 0,
        playing: false,
      };
    }
    case "placeTapeOnFloor": {
      if (
        !isKnownTape(session, action.date) ||
        action.date === session.loadedTapeDate
      ) {
        return session;
      }
      return {
        ...session,
        floorTapes: { ...session.floorTapes, [action.date]: action.position },
      };
    }
    case "returnTapeToBox": {
      const floorTapes = withoutFloorTape(session.floorTapes, action.date);
      if (floorTapes === session.floorTapes) {
        return session;
      }
      return { ...session, floorTapes };
    }
    case "togglePlayback": {
      if (!findLoadedTape(session)) {
        return session;
      }
      return { ...session, playing: !session.playing };
    }
    case "stop": {
      if (!session.playing) {
        return session;
      }
      return { ...session, playing: false };
    }
    case "nextTrack": {
      return moveTrack(session, 1);
    }
    case "previousTrack": {
      return moveTrack(session, -1);
    }
    case "playbackChanged": {
      const tape = findLoadedTape(session);
      if (!tape) {
        return session;
      }
      const trackIndex = tape.tracks.findIndex(
        (track) => track.spotifyUri === action.trackUri,
      );
      // Spotify is playing something that is not on this tape: show it stopped.
      if (trackIndex === -1) {
        return session.playing ? { ...session, playing: false } : session;
      }
      const playing = !action.paused;
      if (trackIndex === session.trackIndex && playing === session.playing) {
        return session;
      }
      return { ...session, trackIndex, playing };
    }
  }
}
