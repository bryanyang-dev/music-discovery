import type { SpotifyConnectionStatus } from "../spotify/use-spotify-player.ts";
import { describeSpotifyStatus } from "./room-status-text.ts";

interface SpotifyPillProps {
  readonly status: SpotifyConnectionStatus;
  readonly failureDetail: string | null;
  /** Shown instead of the Spotify status when set. */
  readonly notice: string | null;
  readonly onConnect: () => void;
}

/** A note on the floor about where the music comes from, with a sign-in button when needed. */
export function SpotifyPill({
  status,
  failureDetail,
  notice,
  onConnect,
}: SpotifyPillProps) {
  const text = describeSpotifyStatus(status, failureDetail);
  return (
    <div className="floor-pill floor-spotify" role="status">
      <span>{notice ?? text.message}</span>
      {text.connectLabel ? (
        <button
          type="button"
          className="floor-spotify__connect"
          onClick={onConnect}
        >
          {text.connectLabel}
        </button>
      ) : null}
    </div>
  );
}
