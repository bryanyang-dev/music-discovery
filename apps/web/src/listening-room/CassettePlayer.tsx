import type { Ref } from "react";
import { Cassette } from "./Cassette.tsx";
import type { Mixtape } from "./models.ts";

const playIconPath = "M6 4l10 6-10 6z";
const pauseIconPath = "M5 4h4v12H5zM11 4h4v12h-4z";
const nextIconPath = "M10 5l7 5-7 5zM2 5l7 5-7 5z";
const previousIconPath = "M10 5l-7 5 7 5zM18 5l-7 5 7 5z";
const defaultVolumePercent = 70;

interface CassettePlayerProps {
  readonly ref: Ref<HTMLDivElement>;
  readonly tape: Mixtape | null;
  readonly trackIndex: number;
  readonly playing: boolean;
  readonly onTogglePlayback: () => void;
  readonly onNextTrack: () => void;
  readonly onPreviousTrack: () => void;
  readonly onStop: () => void;
  readonly onEject: () => void;
}

function describeStatus(tape: Mixtape | null, trackIndex: number, playing: boolean): string {
  if (!tape) {
    return "No tape in the player";
  }
  const playbackState = playing ? "playing" : "stopped";
  return `Side A, track ${trackIndex + 1} of ${tape.tracks.length}, ${playbackState}`;
}

function LcdReadout({ tape, trackIndex, playing }: Pick<CassettePlayerProps, "tape" | "trackIndex" | "playing">) {
  if (!tape) {
    return <span>テープなし</span>;
  }

  const trackNumber = String(trackIndex + 1).padStart(2, "0");
  if (!playing) {
    return (
      <>
        <span>A面 {trackNumber}</span>
        <span>停止</span>
      </>
    );
  }

  return (
    <>
      <span>A面 {trackNumber}</span>
      <span>再生中</span>
      <span className="player__equalizer">
        <span />
        <span />
        <span />
      </span>
    </>
  );
}

export function CassettePlayer({
  ref,
  tape,
  trackIndex,
  playing,
  onTogglePlayback,
  onNextTrack,
  onPreviousTrack,
  onStop,
  onEject,
}: CassettePlayerProps) {
  const hasTape = tape !== null;

  return (
    <div className="player" ref={ref}>
      <div className="player__header">
        <div className="player__brand">
          <div className="player__brand-name">DAILY MIXTAPE</div>
          <div className="player__brand-kana" lang="ja">
            デイリー・ミックステープ
          </div>
        </div>
        <button
          type="button"
          className="player__open"
          aria-label="Open the door to remove the tape"
          disabled={!hasTape}
          onClick={onEject}
        >
          <svg
            width="13"
            height="13"
            viewBox="0 0 20 20"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M10 4l6 7H4zM4 15h12" />
          </svg>
          OPEN
        </button>
      </div>

      <div className="player__window">{tape ? <Cassette tape={tape} variant="player" /> : null}</div>

      <div className="player__footer">
        <div className="player__volume-label">VOL</div>
        <input
          type="range"
          className="player__volume"
          aria-label="Volume"
          min={0}
          max={100}
          defaultValue={defaultVolumePercent}
        />
        <div className="player__lcd" lang="ja" aria-hidden="true">
          <LcdReadout tape={tape} trackIndex={trackIndex} playing={playing} />
        </div>
        <p className="visually-hidden" role="status">
          {describeStatus(tape, trackIndex, playing)}
        </p>
      </div>

      <div className="player__keys">
        <button
          type="button"
          className="player__key player__key--play"
          aria-label={playing ? "Pause" : "Play"}
          disabled={!hasTape}
          onClick={onTogglePlayback}
        >
          <svg width="18" height="18" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
            <path d={playing ? pauseIconPath : playIconPath} />
          </svg>
        </button>
        <button
          type="button"
          className="player__key player__key--seek"
          aria-label="Fast forward to next track"
          disabled={!hasTape}
          onClick={onNextTrack}
        >
          <svg width="18" height="18" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
            <path d={nextIconPath} />
          </svg>
        </button>
        <button
          type="button"
          className="player__key player__key--seek"
          aria-label="Rewind to previous track"
          disabled={!hasTape}
          onClick={onPreviousTrack}
        >
          <svg width="18" height="18" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
            <path d={previousIconPath} />
          </svg>
        </button>
        <button
          type="button"
          className="player__key player__key--stop"
          aria-label="Stop"
          disabled={!hasTape}
          onClick={onStop}
        >
          <svg width="18" height="18" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
            <rect x="5" y="5" width="10" height="10" />
          </svg>
        </button>
      </div>
    </div>
  );
}
