import type { Ref } from "react";
import type { Mixtape } from "./models.ts";
import { describeTapeDate } from "./tape-date-labels.ts";
import type { TapeDragHandlers } from "./use-tape-drag.ts";

interface TapeBoxProps {
  readonly ref: Ref<HTMLElement>;
  readonly tapes: readonly Mixtape[];
  readonly loadedTapeDate: string | null;
  /** Dates of tapes lying on the floor; their slots are empty. */
  readonly floorTapeDates: readonly string[];
  readonly draggingTapeDate: string | null;
  readonly getTapeHandlers: (tapeDate: string) => TapeDragHandlers;
}

/** The box of this week's tapes. A tape that is in the player or on the floor leaves a dashed, empty slot. */
export function TapeBox({
  ref,
  tapes,
  loadedTapeDate,
  floorTapeDates,
  draggingTapeDate,
  getTapeHandlers,
}: TapeBoxProps) {
  return (
    <section ref={ref} className="tape-box" aria-label="This week's tapes">
      <div className="tape-box__tab">
        THIS WEEK<span lang="ja"> ・ 今週</span>
      </div>
      {tapes.map((tape) => {
        const labels = describeTapeDate(tape.date);

        if (tape.date === loadedTapeDate) {
          return (
            <div key={tape.date} className="tape-box__empty-slot">
              {labels.slotLabel} · IN THE PLAYER
            </div>
          );
        }
        if (floorTapeDates.includes(tape.date)) {
          return (
            <div key={tape.date} className="tape-box__empty-slot">
              {labels.slotLabel} · ON THE FLOOR
            </div>
          );
        }

        const isDragging = tape.date === draggingTapeDate;
        return (
          <button
            key={tape.date}
            type="button"
            className={isDragging ? "tape-box__tape tape-box__tape--lifted" : "tape-box__tape"}
            data-weekday={labels.weekdayIndex}
            aria-label={`Load tape, ${labels.spokenDate}`}
            {...getTapeHandlers(tape.date)}
          >
            <span className="tape-box__tape-label">
              <span>{labels.tapeLabel}</span>
              <span lang="ja" aria-hidden="true" className="tape-box__tape-kanji">
                {labels.weekdayKanji}
              </span>
            </span>
          </button>
        );
      })}
    </section>
  );
}
