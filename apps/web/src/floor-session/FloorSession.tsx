import { useCallback, useReducer, useRef } from "react";
import { CassettePlayer } from "./CassettePlayer.tsx";
import { IcedTea, SleepingCat, Sparkle } from "./FloorDecor.tsx";
import { FloorItem } from "./FloorItem.tsx";
import { FloorTape, floorCassetteHalfSizePx } from "./FloorTape.tsx";
import { Headphones } from "./Headphones.tsx";
import { JCard } from "./JCard.tsx";
import { createMixtapeSession, findLoadedTape, reduceMixtapeSession } from "./mixtape-session.ts";
import type { FloorPosition } from "./models.ts";
import { RoomAtmosphere } from "./RoomAtmosphere.tsx";
import { createSampleWeek } from "./sample-mixtapes.ts";
import { TapeBox } from "./TapeBox.tsx";
import { ThemeLamp, type FloorTheme } from "./ThemeLamp.tsx";
import { stageHeightPx, stageWidthPx, useStageScale } from "./use-stage-scale.ts";
import { useTapeDrag, type TapeDropTarget } from "./use-tape-drag.ts";
import "./floor-session.css";

/** Keeps a dropped cassette fully on the artboard so it can always be picked up again. */
function clampToFloor(center: FloorPosition): FloorPosition {
  return {
    x: Math.min(Math.max(center.x, floorCassetteHalfSizePx.x), stageWidthPx - floorCassetteHalfSizePx.x),
    y: Math.min(Math.max(center.y, floorCassetteHalfSizePx.y), stageHeightPx - floorCassetteHalfSizePx.y),
  };
}

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
  const boxRef = useRef<HTMLElement>(null);
  const scale = useStageScale(viewportRef);

  const loadTape = useCallback((tapeDate: string) => {
    dispatch({ type: "loadTape", date: tapeDate });
  }, []);
  const dropTape = useCallback((tapeDate: string, target: TapeDropTarget, center: FloorPosition) => {
    if (target === "player") {
      dispatch({ type: "loadTape", date: tapeDate });
    } else if (target === "box") {
      dispatch({ type: "returnTapeToBox", date: tapeDate });
    } else {
      dispatch({ type: "placeTapeOnFloor", date: tapeDate, position: clampToFloor(center) });
    }
  }, []);
  const { drag, getTapeHandlers } = useTapeDrag({
    stageRef,
    playerRef,
    boxRef,
    onDropTape: dropTape,
    onActivateTape: loadTape,
  });

  const loadedTape = findLoadedTape(session);
  const draggedTape = drag ? (session.tapes.find((tape) => tape.date === drag.tapeDate) ?? null) : null;
  const floorTapeDates = Object.keys(session.floorTapes);

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

          <FloorItem stageRef={stageRef} dragHandle="anywhere">
            <ThemeLamp theme={theme} onToggleTheme={onToggleTheme} />
          </FloorItem>
          <FloorItem stageRef={stageRef}>
            <Headphones playing={session.playing} />
          </FloorItem>

          <FloorItem stageRef={stageRef}>
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
            <Sparkle owner="player" />
          </FloorItem>

          {/* Stays mounted while the player is empty so the card reappears where it was left. */}
          <FloorItem stageRef={stageRef}>
            {loadedTape ? <JCard tape={loadedTape} trackIndex={session.trackIndex} /> : null}
          </FloorItem>

          <FloorItem stageRef={stageRef}>
            <TapeBox
              ref={boxRef}
              tapes={session.tapes}
              loadedTapeDate={session.loadedTapeDate}
              floorTapeDates={floorTapeDates}
              draggingTapeDate={drag?.tapeDate ?? null}
              getTapeHandlers={(tapeDate) => getTapeHandlers(tapeDate, "box")}
            />
            <Sparkle owner="box" />
          </FloorItem>
          <FloorItem stageRef={stageRef}>
            <div className="floor-pill floor-hint">Drop a tape on the player to load it</div>
          </FloorItem>

          <FloorItem stageRef={stageRef}>
            <IcedTea />
          </FloorItem>
          <FloorItem stageRef={stageRef}>
            <SleepingCat />
          </FloorItem>

          {session.tapes.map((tape) => {
            const center = session.floorTapes[tape.date];
            if (!center) {
              return null;
            }
            // While this tape is being carried, its button stays mounted (it holds the pointer) but hidden.
            const isCarried = drag?.tapeDate === tape.date;
            return (
              <div key={tape.date} className={isCarried ? "floor-tape-slot floor-tape-slot--carried" : "floor-tape-slot"}>
                <FloorTape
                  tape={tape}
                  center={center}
                  lifted={false}
                  handlers={getTapeHandlers(tape.date, "floor")}
                />
              </div>
            );
          })}

          {drag && draggedTape ? <FloorTape tape={draggedTape} center={drag.center} lifted={true} /> : null}
        </main>
      </div>
    </div>
  );
}
