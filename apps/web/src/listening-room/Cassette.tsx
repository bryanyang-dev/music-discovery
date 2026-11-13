import type { Mixtape } from "./models.ts";
import { describeTapeWeek } from "./tape-week-labels.ts";

interface CassetteProps {
  readonly tape: Mixtape;
  /** "player" is the tape seen through the player window; "drag" is the tape lifted off the floor. */
  readonly variant: "player" | "drag";
}

export function Cassette({ tape, variant }: CassetteProps) {
  const labels = describeTapeWeek(tape.date);

  return (
    <div
      className={`cassette cassette--${variant}`}
      data-tape-color={labels.colorIndex}
    >
      <div className="cassette__label">
        <div className="cassette__date">{labels.tapeLabel}</div>
        <div className="cassette__stamp" lang="ja" aria-hidden="true">
          週
        </div>
        <div className="cassette__reels" aria-hidden="true">
          <div className="cassette__reel" />
          <div className="cassette__reel" />
        </div>
      </div>
      <div className="cassette__foot" aria-hidden="true" />
    </div>
  );
}
