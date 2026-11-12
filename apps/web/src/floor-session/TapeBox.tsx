import type { Mixtape } from "./models.ts";
import { describeTapeDate } from "./tape-date-labels.ts";
import type { TapeSlotHandlers } from "./use-tape-drag.ts";

interface TapeBoxProps {
  readonly tapes: readonly Mixtape[];
  readonly loadedTapeDate: string | null;
  readonly draggingTapeDate: string | null;
  readonly getSlotHandlers: (tapeDate: string) => TapeSlotHandlers;
}

/** The box of this week's tapes. The loaded tape leaves an empty, dashed slot behind. */
export function TapeBox({ tapes, loadedTapeDate, draggingTapeDate, getSlotHandlers }: TapeBoxProps) {
  return (
    <section className="tape-box" aria-label="This week's tapes">
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

        const isDragging = tape.date === draggingTapeDate;
        return (
          <button
            key={tape.date}
            type="button"
            className={isDragging ? "tape-box__tape tape-box__tape--lifted" : "tape-box__tape"}
            data-weekday={labels.weekdayIndex}
            aria-label={`Load tape, ${labels.spokenDate}`}
            {...getSlotHandlers(tape.date)}
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
