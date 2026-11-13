import { useCallback, useEffect, useRef, useState } from "react";
import type { PlaybackCommand } from "../listening-room/tape-playback.ts";
import type { SpotifyTokenSource } from "./spotify-auth.ts";
import {
  describeSpotifyDevices,
  loadSpotifySdk,
  SpotifyPlaybackError,
  SPOTIFY_START_POLICY,
  startTapeOnDevice,
  toPlaybackSnapshot,
  type PlaybackSnapshot,
  type SdkPlayer,
  type SpotifyPlayerStatus,
} from "./spotify-player.ts";

export type SpotifyConnectionStatus = SpotifyPlayerStatus | "signed_out";

export interface SpotifyPlayback {
  readonly status: SpotifyConnectionStatus;
  readonly snapshot: PlaybackSnapshot;
  /** Spotify's explanation of the last failure, for the status pill. */
  readonly failureDetail: string | null;
  /** Call from the user gesture (click) so the browser allows audio. */
  run(command: PlaybackCommand): void;
  pause(): void;
  setVolumePercent(percent: number): void;
}

const playerName = "Tape Journal";
const idleSnapshot: PlaybackSnapshot = { trackUri: null, paused: true };

/**
 * Connects this browser as a Spotify playback device while `tokenSource` is
 * set. `onSnapshot` receives every player state change.
 */
export function useSpotifyPlayer(
  tokenSource: SpotifyTokenSource | null,
  initialVolumePercent: number,
  onSnapshot: (snapshot: PlaybackSnapshot) => void,
): SpotifyPlayback {
  const [status, setStatus] = useState<SpotifyConnectionStatus>(
    tokenSource ? "connecting" : "signed_out",
  );
  const [snapshot, setSnapshot] = useState<PlaybackSnapshot>(idleSnapshot);
  const [failureDetail, setFailureDetail] = useState<string | null>(null);
  const fail = useCallback(
    (nextStatus: SpotifyConnectionStatus, detail: string) => {
      console.error(`Spotify ${nextStatus}: ${detail}`);
      setFailureDetail(detail);
      setStatus(nextStatus);
    },
    [],
  );
  const playerRef = useRef<SdkPlayer | null>(null);
  const deviceIdRef = useRef<string | null>(null);
  const onSnapshotRef = useRef(onSnapshot);
  onSnapshotRef.current = onSnapshot;
  const initialVolumeRef = useRef(initialVolumePercent);
  const lastSnapshotRef = useRef<PlaybackSnapshot>(idleSnapshot);
  /** True from a start click until Spotify answers the start requests. */
  const startInFlightRef = useRef(false);
  /** Pending check that a requested tape start actually began playing here. */
  const startTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clearStartTimeout = useCallback(() => {
    if (startTimeoutRef.current !== null) {
      clearTimeout(startTimeoutRef.current);
      startTimeoutRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (!tokenSource) {
      setStatus("signed_out");
      return;
    }
    let cancelled = false;
    let player: SdkPlayer | null = null;
    setStatus("connecting");
    loadSpotifySdk().then(
      (sdk) => {
        if (cancelled) {
          return;
        }
        player = new sdk.Player({
          name: playerName,
          volume: initialVolumeRef.current / 100,
          getOAuthToken: (callback) => {
            tokenSource.getAccessToken().then(callback, (error: unknown) => {
              if (!cancelled) {
                fail("auth_failed", String(error));
              }
            });
          },
        });
        player.addListener("ready", ({ device_id }) => {
          deviceIdRef.current = device_id;
          setStatus("ready");
        });
        player.addListener("not_ready", () => {
          deviceIdRef.current = null;
          setStatus("offline");
        });
        player.addListener("player_state_changed", (state) => {
          const next = toPlaybackSnapshot(state);
          lastSnapshotRef.current = next;
          console.info(
            `Spotify player state: ${next.trackUri ?? "no track"}, ${next.paused ? "paused" : "playing"}`,
          );
          if (!next.paused) {
            clearStartTimeout();
          }
          setSnapshot(next);
          onSnapshotRef.current(next);
          if (state === null) {
            // Playback moved to another device.
            setStatus("offline");
          } else if (deviceIdRef.current !== null) {
            setFailureDetail(null);
            setStatus("ready");
          }
        });
        player.addListener("initialization_error", ({ message }) =>
          fail("unsupported_browser", message),
        );
        player.addListener("authentication_error", ({ message }) =>
          fail("auth_failed", message),
        );
        player.addListener("account_error", ({ message }) =>
          fail("premium_required", message),
        );
        player.addListener("playback_error", ({ message }) =>
          fail("playback_failed", message),
        );
        playerRef.current = player;
        void player.connect();
      },
      (error: unknown) => {
        if (!cancelled) {
          fail("unsupported_browser", String(error));
        }
      },
    );
    return () => {
      cancelled = true;
      clearStartTimeout();
      player?.disconnect();
      playerRef.current = null;
      deviceIdRef.current = null;
      setSnapshot(idleSnapshot);
    };
  }, [tokenSource, fail, clearStartTimeout]);

  const run = useCallback(
    (command: PlaybackCommand) => {
      const player = playerRef.current;
      console.info(`Tape Journal playback command: ${command.kind}`);
      if (!player || !tokenSource) {
        console.warn("Spotify player is not connected; command ignored.");
        return;
      }
      switch (command.kind) {
        case "none": {
          return;
        }
        case "toggle": {
          void player.togglePlay();
          return;
        }
        case "next": {
          void player.nextTrack();
          return;
        }
        case "previous": {
          void player.previousTrack();
          return;
        }
        case "start": {
          const deviceId = deviceIdRef.current;
          if (deviceId === null || startInFlightRef.current) {
            console.warn("Spotify device not ready or a start is in progress.");
            return;
          }
          // Must run inside the click for browser autoplay rules.
          void player.activateElement();
          setFailureDetail(null);
          setStatus("starting");
          clearStartTimeout();
          startInFlightRef.current = true;
          tokenSource
            .getAccessToken()
            .then((accessToken) =>
              startTapeOnDevice({
                accessToken,
                deviceId,
                uris: command.uris,
                offset: command.offset,
              }),
            )
            .then(() => {
              startInFlightRef.current = false;
              startTimeoutRef.current = setTimeout(() => {
                startTimeoutRef.current = null;
                // The player may have reported playing before Spotify answered.
                const current = lastSnapshotRef.current;
                if (
                  !current.paused &&
                  command.uris.includes(current.trackUri ?? "")
                ) {
                  return;
                }
                fail(
                  "playback_failed",
                  "Spotify accepted the tape, but this browser's player never started",
                );
              }, SPOTIFY_START_POLICY.playbackConfirmTimeoutMs);
            })
            .catch((error: unknown) => {
              startInFlightRef.current = false;
              if (
                error instanceof SpotifyPlaybackError &&
                error.status === 404
              ) {
                void tokenSource
                  .getAccessToken()
                  .then((accessToken) =>
                    describeSpotifyDevices({ accessToken }),
                  )
                  .then((devices) =>
                    console.info(
                      `This browser is device ${deviceId}. Spotify knows: ${devices.join("; ")}`,
                    ),
                  )
                  .catch(() => {});
              }
              fail(
                "playback_failed",
                error instanceof Error ? error.message : String(error),
              );
            });
          return;
        }
      }
    },
    [tokenSource, fail, clearStartTimeout],
  );

  const pause = useCallback(() => {
    void playerRef.current?.pause();
  }, []);

  const setVolumePercent = useCallback((percent: number) => {
    initialVolumeRef.current = percent;
    void playerRef.current?.setVolume(percent / 100);
  }, []);

  return { status, snapshot, failureDetail, run, pause, setVolumePercent };
}
