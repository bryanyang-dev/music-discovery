/** Minimal types for the Spotify Web Playback SDK, plus the calls the cassette uses. */

interface SdkTrack {
  readonly uri: string;
  /** Set when Spotify relinked the requested track to a playable one. */
  readonly linked_from?: { readonly uri: string | null };
}

export interface SdkPlaybackState {
  readonly paused: boolean;
  readonly track_window: { readonly current_track: SdkTrack | null };
}

interface SdkError {
  readonly message: string;
}

export interface SdkPlayer {
  connect(): Promise<boolean>;
  disconnect(): void;
  activateElement(): Promise<void>;
  togglePlay(): Promise<void>;
  pause(): Promise<void>;
  nextTrack(): Promise<void>;
  previousTrack(): Promise<void>;
  setVolume(volume: number): Promise<void>;
  addListener(
    event: "ready" | "not_ready",
    callback: (data: { device_id: string }) => void,
  ): boolean;
  addListener(
    event: "player_state_changed",
    callback: (state: SdkPlaybackState | null) => void,
  ): boolean;
  addListener(
    event:
      | "initialization_error"
      | "authentication_error"
      | "account_error"
      | "playback_error",
    callback: (error: SdkError) => void,
  ): boolean;
}

interface SdkNamespace {
  readonly Player: new (options: {
    name: string;
    getOAuthToken: (callback: (accessToken: string) => void) => void;
    volume?: number;
  }) => SdkPlayer;
}

declare global {
  interface Window {
    Spotify?: SdkNamespace;
    onSpotifyWebPlaybackSDKReady?: () => void;
  }
}

const sdkScriptUrl = "https://sdk.scdn.co/spotify-player.js";
let sdkLoading: Promise<SdkNamespace> | null = null;

/** Loads the SDK script once per page. */
export function loadSpotifySdk(): Promise<SdkNamespace> {
  sdkLoading ??= new Promise<SdkNamespace>((resolve, reject) => {
    if (window.Spotify) {
      resolve(window.Spotify);
      return;
    }
    window.onSpotifyWebPlaybackSDKReady = () => {
      if (window.Spotify) {
        resolve(window.Spotify);
      } else {
        reject(new Error("Spotify SDK did not initialise."));
      }
    };
    const script = document.createElement("script");
    script.src = sdkScriptUrl;
    script.async = true;
    script.onerror = () => {
      sdkLoading = null;
      reject(new Error("Spotify SDK failed to load."));
    };
    document.head.append(script);
  });
  return sdkLoading;
}

export type SpotifyPlayerStatus =
  | "connecting"
  | "ready"
  /** A tape start was requested and Spotify has not yet reported it playing. */
  | "starting"
  /** The device went offline or playback moved to another device. */
  | "offline"
  | "premium_required"
  | "auth_failed"
  | "unsupported_browser"
  | "playback_failed";

export interface PlaybackSnapshot {
  readonly trackUri: string | null;
  readonly paused: boolean;
}

/**
 * The tape's own URI for the current track. Spotify may substitute a relinked
 * recording; `linked_from` keeps the URI that was requested.
 */
export function toPlaybackSnapshot(
  state: SdkPlaybackState | null,
): PlaybackSnapshot {
  const track = state?.track_window.current_track ?? null;
  return {
    trackUri: track?.linked_from?.uri ?? track?.uri ?? null,
    paused: state?.paused ?? true,
  };
}

export class SpotifyPlaybackError extends Error {
  readonly status: number;

  constructor(status: number, detail: string) {
    super(`HTTP ${status}${detail ? `: ${detail}` : ""}`);
    this.name = "SpotifyPlaybackError";
    this.status = status;
  }
}

type StepLogger = (message: string) => void;

async function playerRequest(
  fetcher: typeof fetch,
  log: StepLogger,
  accessToken: string,
  url: URL,
  body: unknown,
): Promise<void> {
  const response = await fetcher(url, {
    method: "PUT",
    headers: {
      authorization: `Bearer ${accessToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
  log(`Spotify PUT ${url.pathname} → HTTP ${response.status}`);
  if (response.ok) {
    return;
  }
  // Player errors look like { error: { status, message, reason } }.
  const error = (
    (await response.json().catch(() => null)) as {
      error?: { message?: unknown; reason?: unknown };
    } | null
  )?.error;
  const detail = [error?.reason, error?.message]
    .filter((part): part is string => typeof part === "string" && part !== "")
    .join(" – ");
  throw new SpotifyPlaybackError(response.status, detail);
}

export const SPOTIFY_START_POLICY = {
  /**
   * Spotify can answer 404 for a device the SDK has just reported ready while
   * its registration propagates; playback transfer is retried this many times.
   */
  maxTransferAttempts: 5,
  /** Wait before transfer attempt n is n times this (1 s, 2 s, … ≈ 15 s in total). */
  transferRetryStepMs: 1_000,
  /** After Spotify accepts a start, the browser player must report playing within this. */
  playbackConfirmTimeoutMs: 10_000,
} as const;

const wait = (milliseconds: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

function isDeviceNotFound(error: unknown): boolean {
  return error instanceof SpotifyPlaybackError && error.status === 404;
}

/**
 * One line per device Spotify knows for this account, for diagnosing a 404:
 * if this browser's device ID is missing here, Spotify never registered it.
 */
export async function describeSpotifyDevices(options: {
  accessToken: string;
  fetcher?: typeof fetch;
}): Promise<string[]> {
  const response = await (options.fetcher ?? fetch)(
    "https://api.spotify.com/v1/me/player/devices",
    { headers: { authorization: `Bearer ${options.accessToken}` } },
  );
  if (!response.ok) {
    return [`device list unavailable (HTTP ${response.status})`];
  }
  const body = (await response.json().catch(() => null)) as {
    devices?: { id?: unknown; name?: unknown; is_active?: unknown }[];
  } | null;
  const devices = body?.devices ?? [];
  if (devices.length === 0) {
    return ["no devices"];
  }
  return devices.map(
    (device) =>
      `${String(device.name)} (${String(device.id)}${device.is_active === true ? ", active" : ""})`,
  );
}

/**
 * Starts `uris` on this browser's SDK device, at the track `offset`. If Spotify
 * does not know the device yet (404), playback is transferred to it with
 * increasing waits, then the start is retried once.
 */
export async function startTapeOnDevice(options: {
  accessToken: string;
  deviceId: string;
  uris: readonly string[];
  offset: number;
  fetcher?: typeof fetch;
  sleep?: (milliseconds: number) => Promise<void>;
  /** Receives one line per Spotify request; defaults to the browser console. */
  log?: StepLogger;
}): Promise<void> {
  const fetcher = options.fetcher ?? fetch;
  const sleep = options.sleep ?? wait;
  const log = options.log ?? ((message: string) => console.info(message));
  const playUrl = new URL("https://api.spotify.com/v1/me/player/play");
  playUrl.searchParams.set("device_id", options.deviceId);
  const playBody = {
    uris: options.uris,
    offset: { position: options.offset },
  };
  try {
    await playerRequest(fetcher, log, options.accessToken, playUrl, playBody);
    return;
  } catch (error) {
    if (!isDeviceNotFound(error)) {
      throw error;
    }
  }
  for (
    let attempt = 1;
    attempt <= SPOTIFY_START_POLICY.maxTransferAttempts;
    attempt += 1
  ) {
    await sleep(attempt * SPOTIFY_START_POLICY.transferRetryStepMs);
    try {
      await playerRequest(
        fetcher,
        log,
        options.accessToken,
        new URL("https://api.spotify.com/v1/me/player"),
        { device_ids: [options.deviceId], play: false },
      );
      break;
    } catch (error) {
      if (
        !isDeviceNotFound(error) ||
        attempt === SPOTIFY_START_POLICY.maxTransferAttempts
      ) {
        throw error;
      }
    }
  }
  await playerRequest(fetcher, log, options.accessToken, playUrl, playBody);
}
