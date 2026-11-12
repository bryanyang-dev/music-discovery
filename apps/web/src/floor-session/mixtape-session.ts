import type { Mixtape } from "./models.ts";

/** What the player is doing. Playback is visual only; there is no audio source yet. */
export interface MixtapeSession {
  readonly tapes: readonly Mixtape[];
  readonly loadedTapeDate: string | null;
  readonly trackIndex: number;
  readonly playing: boolean;
}

export type MixtapeSessionAction =
  | { readonly type: "loadTape"; readonly date: string }
  | { readonly type: "ejectTape" }
  | { readonly type: "togglePlayback" }
  | { readonly type: "stop" }
  | { readonly type: "nextTrack" }
  | { readonly type: "previousTrack" };

/** Starts with the newest tape (the first one) in the player, stopped. */
export function createMixtapeSession(tapes: readonly Mixtape[]): MixtapeSession {
  return {
    tapes,
    loadedTapeDate: tapes[0]?.date ?? null,
    trackIndex: 0,
    playing: false,
  };
}

export function findLoadedTape(session: MixtapeSession): Mixtape | null {
  if (session.loadedTapeDate === null) {
    return null;
  }
  return session.tapes.find((tape) => tape.date === session.loadedTapeDate) ?? null;
}

function moveTrack(session: MixtapeSession, step: number): MixtapeSession {
  const tape = findLoadedTape(session);
  if (!tape) {
    return session;
  }
  const lastTrackIndex = tape.tracks.length - 1;
  const trackIndex = Math.min(Math.max(session.trackIndex + step, 0), lastTrackIndex);
  if (trackIndex === session.trackIndex) {
    return session;
  }
  return { ...session, trackIndex };
}

export function reduceMixtapeSession(session: MixtapeSession, action: MixtapeSessionAction): MixtapeSession {
  switch (action.type) {
    case "loadTape": {
      const isKnownTape = session.tapes.some((tape) => tape.date === action.date);
      if (!isKnownTape || action.date === session.loadedTapeDate) {
        return session;
      }
      return { ...session, loadedTapeDate: action.date, trackIndex: 0, playing: false };
    }
    case "ejectTape": {
      if (session.loadedTapeDate === null) {
        return session;
      }
      return { ...session, loadedTapeDate: null, trackIndex: 0, playing: false };
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
  }
}
