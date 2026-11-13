import { Cassette } from "./Cassette.tsx";
import type { FloorPosition, Mixtape } from "./models.ts";
import { describeTapeWeek } from "./tape-week-labels.ts";
import type { TapeDragHandlers } from "./use-tape-drag.ts";

/** Half the floor cassette's size: positions are the cassette's centre. */
export const floorCassetteHalfSizePx = { x: 95, y: 60 };

interface FloorTapeProps {
  readonly tape: Mixtape;
  readonly center: FloorPosition;
  /** Lifted tapes follow the pointer, cast a longer shadow and ignore the pointer themselves. */
  readonly lifted: boolean;
  /** Present for a tape resting on the floor, which can be picked up again or loaded with a click. */
  readonly handlers?: TapeDragHandlers;
}

/** A full-size cassette on the floor, either resting where it was dropped or being carried. */
export function FloorTape({ tape, center, lifted, handlers }: FloorTapeProps) {
  const style = {
    left: center.x - floorCassetteHalfSizePx.x,
    top: center.y - floorCassetteHalfSizePx.y,
  };

  if (lifted || !handlers) {
    return (
      <div
        className="floor-tape floor-tape--lifted"
        aria-hidden="true"
        style={style}
      >
        <Cassette tape={tape} variant="drag" />
      </div>
    );
  }

  return (
    <button
      type="button"
      className="floor-tape"
      style={style}
      aria-label={`Load tape from the floor, ${describeTapeWeek(tape.date).spokenWeek}`}
      {...handlers}
    >
      <Cassette tape={tape} variant="drag" />
    </button>
  );
}
