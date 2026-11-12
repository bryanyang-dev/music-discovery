import { useCallback, useReducer, useRef } from "react";
import { Cassette } from "./Cassette.tsx";
import { CassettePlayer } from "./CassettePlayer.tsx";
import { IcedTea, SleepingCat, Sparkles } from "./FloorDecor.tsx";
import { Headphones } from "./Headphones.tsx";
import { JCard } from "./JCard.tsx";
import { createMixtapeSession, findLoadedTape, reduceMixtapeSession } from "./mixtape-session.ts";
import { RoomAtmosphere } from "./RoomAtmosphere.tsx";
import { createSampleWeek } from "./sample-mixtapes.ts";
import { TapeBox } from "./TapeBox.tsx";
import { ThemeLamp, type FloorTheme } from "./ThemeLamp.tsx";
import { stageHeightPx, stageWidthPx, useStageScale } from "./use-stage-scale.ts";
import { useTapeDrag } from "./use-tape-drag.ts";
import "./floor-session.css";

/** Half the lifted cassette's size, so it is carried by its centre. */
const draggedCassetteOffsetPx = { x: 95, y: 60 };

interface FloorSessionProps {
  readonly theme: FloorTheme;
  readonly onToggleTheme: () => void;
  /** The newest tape is dated today; the box holds the week ending today. */
  readonly today: Date;
}

/** The whole scene: a tatami floor with the cassette player, this week's tapes and the room around them. */
export function FloorSession({ theme, onToggleTheme, today }: FloorSessionProps) {
  const [session, dispatch] = useReducer(reduceMixtapeSession, today, (date) =>
    createMixtapeSession(createSampleWeek(date)),
  );
  const viewportRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLElement>(null);
  const playerRef = useRef<HTMLDivElement>(null);
  const scale = useStageScale(viewportRef);

  const loadTape = useCallback((tapeDate: string) => {
    dispatch({ type: "loadTape", date: tapeDate });
  }, []);
  const { drag, getSlotHandlers } = useTapeDrag({ stageRef, playerRef, onLoadTape: loadTape });

  const loadedTape = findLoadedTape(session);
  const draggedTape = drag ? (session.tapes.find((tape) => tape.date === drag.tapeDate) ?? null) : null;

  return (
    <div ref={viewportRef} className="floor-viewport" data-theme={theme}>
      <div className="floor-frame" style={{ width: stageWidthPx * scale, height: stageHeightPx * scale }}>
        <main
          ref={stageRef}
          className={session.playing ? "floor-stage floor-stage--playing" : "floor-stage"}
          style={{ transform: `scale(${scale})` }}
        >
          <h1 className="visually-hidden">Daily Mixtape</h1>

          <RoomAtmosphere />
          <ThemeLamp theme={theme} onToggleTheme={onToggleTheme} />
          <Headphones playing={session.playing} />

          <CassettePlayer
            ref={playerRef}
            tape={loadedTape}
            trackIndex={session.trackIndex}
            playing={session.playing}
            onTogglePlayback={() => dispatch({ type: "togglePlayback" })}
            onNextTrack={() => dispatch({ type: "nextTrack" })}
            onPreviousTrack={() => dispatch({ type: "previousTrack" })}
            onStop={() => dispatch({ type: "stop" })}
            onEject={() => dispatch({ type: "ejectTape" })}
          />
          <Sparkles />

          {loadedTape ? <JCard tape={loadedTape} trackIndex={session.trackIndex} /> : null}

          <TapeBox
            tapes={session.tapes}
            loadedTapeDate={session.loadedTapeDate}
            draggingTapeDate={drag?.tapeDate ?? null}
            getSlotHandlers={getSlotHandlers}
          />
          <div className="floor-pill floor-hint">Drop a tape on the player to load it</div>

          <IcedTea />
          <SleepingCat />

          {drag && draggedTape ? (
            <div
              className="tape-drag"
              aria-hidden="true"
              style={{ left: drag.x - draggedCassetteOffsetPx.x, top: drag.y - draggedCassetteOffsetPx.y }}
            >
              <Cassette tape={draggedTape} variant="drag" />
            </div>
          ) : null}
        </main>
      </div>
    </div>
  );
}
