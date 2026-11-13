import type { SpotifyConnectionStatus } from "../spotify/use-spotify-player.ts";

export interface SpotifyStatusText {
  readonly message: string;
  /** Label of the button that (re)starts Spotify sign-in, when one is offered. */
  readonly connectLabel: string | null;
}

const failureStatuses = new Set<SpotifyConnectionStatus>([
  "playback_failed",
  "auth_failed",
  "premium_required",
  "unsupported_browser",
]);

export function describeSpotifyStatus(
  status: SpotifyConnectionStatus,
  failureDetail: string | null = null,
): SpotifyStatusText {
  const text = describeStatusOnly(status);
  if (failureDetail === null || !failureStatuses.has(status)) {
    return text;
  }
  return { ...text, message: `${text.message} (${failureDetail})` };
}

function describeStatusOnly(
  status: SpotifyConnectionStatus,
): SpotifyStatusText {
  switch (status) {
    case "signed_out":
      return {
        message: "Tapes play silently",
        connectLabel: "Connect Spotify",
      };
    case "connecting":
      return { message: "Connecting to Spotify…", connectLabel: null };
    case "ready":
      return { message: "Spotify connected", connectLabel: null };
    case "starting":
      return { message: "Starting the tape…", connectLabel: null };
    case "offline":
      return {
        message: "Spotify is playing on another device",
        connectLabel: null,
      };
    case "premium_required":
      return { message: "Spotify Premium is required", connectLabel: null };
    case "unsupported_browser":
      return { message: "This browser can't play Spotify", connectLabel: null };
    case "auth_failed":
      return { message: "Spotify sign-in expired", connectLabel: "Reconnect" };
    case "playback_failed":
      return { message: "Spotify couldn't play that", connectLabel: null };
  }
}

const tapeLoadMessages: Record<string, string> = {
  API_UNREACHABLE: "Can't reach the tape API. Is `pnpm api:dev` running?",
  INVALID_RESPONSE: "The tape API sent something unexpected.",
};

export function describeTapeLoadError(code: string): string {
  return tapeLoadMessages[code] ?? `Couldn't load tapes (${code}).`;
}
