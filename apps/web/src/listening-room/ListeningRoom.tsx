import { useCallback, useEffect, useReducer, useRef } from "react";
import type { SpotifyTokenSource } from "../spotify/spotify-auth.ts";
import { useSpotifyPlayer } from "../spotify/use-spotify-player.ts";
import { CassettePlayer, defaultVolumePercent } from "./CassettePlayer.tsx";
import { IcedTea, SleepingCat, Sparkle } from "./FloorDecor.tsx";
import { FloorItem } from "./FloorItem.tsx";
import { FloorTape, floorCassetteHalfSizePx } from "./FloorTape.tsx";
import { Headphones } from "./Headphones.tsx";
import { JCard } from "./JCard.tsx";
import {
  createMixtapeSession,
  findLoadedTape,
  reduceMixtapeSession,
} from "./mixtape-session.ts";
import type { FloorPosition, Mixtape } from "./models.ts";
import { RoomAtmosphere } from "./RoomAtmosphere.tsx";
import { SpotifyPill } from "./SpotifyPill.tsx";
import { TapeBox } from "./TapeBox.tsx";
import { planSkip, planTogglePlayback } from "./tape-playback.ts";
import { ThemeLamp, type FloorTheme } from "./ThemeLamp.tsx";
import {
  stageHeightPx,
  stageWidthPx,
  useStageScale,
} from "./use-stage-scale.ts";
import { useTapeDrag, type TapeDropTarget } from "./use-tape-drag.ts";
import "./listening-room.css";

/** Keeps a dropped cassette fully on the artboard so it can always be picked up again. */
function clampToFloor(center: FloorPosition): FloorPosition {
  return {
    x: Math.min(
      Math.max(center.x, floorCassetteHalfSizePx.x),
      stageWidthPx - floorCassetteHalfSizePx.x,
    ),
    y: Math.min(
      Math.max(center.y, floorCassetteHalfSizePx.y),
      stageHeightPx - floorCassetteHalfSizePx.y,
    ),
  };
}

interface ListeningRoomProps {
  readonly theme: FloorTheme;
  readonly onToggleTheme: () => void;
  /** Recent weekly tapes, newest first. */
  readonly tapes: readonly Mixtape[];
  /** Set while signed in to Spotify; playback then goes through Spotify. */
  readonly spotifyTokens: SpotifyTokenSource | null;
  readonly onConnectSpotify: () => void;
  /** A problem to show on the floor, such as tapes failing to load. */
  readonly notice: string | null;
}

/** The whole scene: a tatami floor with the cassette player, recent weekly tapes and the room around them. */
export function ListeningRoom({
  theme,
  onToggleTheme,
  tapes,
  spotifyTokens,
  onConnectSpotify,
  notice,
}: ListeningRoomProps) {
  const [session, dispatch] = useReducer(
    reduceMixtapeSession,
    tapes,
    createMixtapeSession,
  );
  // The room is never remounted for new tapes: remounting would also replace the
  // Spotify player, and Spotify does not reliably register a second player.
  useEffect(() => {
    dispatch({ type: "tapesLoaded", tapes });
  }, [tapes]);
  const spotify = useSpotifyPlayer(
    spotifyTokens,
    defaultVolumePercent,
    useCallback(({ trackUri, paused }) => {
      dispatch({ type: "playbackChanged", trackUri, paused });
    }, []),
  );
  const spotifyReady = spotify.status === "ready";
  const { pause: pauseSpotify } = spotify;
  const viewportRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLElement>(null);
  const playerRef = useRef<HTMLDivElement>(null);
  const boxRef = useRef<HTMLElement>(null);
  const scale = useStageScale(viewportRef);

  // Swapping or removing the tape stops the music that belonged to the old one.
  const loadTape = useCallback(
    (tapeDate: string) => {
      pauseSpotify();
      dispatch({ type: "loadTape", date: tapeDate });
    },
    [pauseSpotify],
  );
  const dropTape = useCallback(
    (tapeDate: string, target: TapeDropTarget, center: FloorPosition) => {
      if (target === "player") {
        loadTape(tapeDate);
      } else if (target === "box") {
        dispatch({ type: "returnTapeToBox", date: tapeDate });
      } else {
        dispatch({
          type: "placeTapeOnFloor",
          date: tapeDate,
          position: clampToFloor(center),
        });
      }
    },
    [loadTape],
  );
  const { drag, getTapeHandlers } = useTapeDrag({
    stageRef,
    playerRef,
    boxRef,
    onDropTape: dropTape,
    onActivateTape: loadTape,
  });

  const loadedTape = findLoadedTape(session);
  const draggedTape = drag
    ? (session.tapes.find((tape) => tape.date === drag.tapeDate) ?? null)
    : null;
  const floorTapeDates = Object.keys(session.floorTapes);

  return (
    <div ref={viewportRef} className="floor-viewport" data-theme={theme}>
      <div
        className="floor-frame"
        style={{ width: stageWidthPx * scale, height: stageHeightPx * scale }}
      >
        <main
          ref={stageRef}
          className={
            session.playing ? "floor-stage floor-stage--playing" : "floor-stage"
          }
          style={{ transform: `scale(${scale})` }}
        >
          <h1 className="visually-hidden">Weekly Mixtape</h1>

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
              onTogglePlayback={() => {
                if (spotifyReady) {
                  spotify.run(
                    planTogglePlayback(session, spotify.snapshot.trackUri),
                  );
                } else {
                  dispatch({ type: "togglePlayback" });
                }
              }}
              onNextTrack={() => {
                const command = spotifyReady
                  ? planSkip(session, spotify.snapshot.trackUri, "next")
                  : { kind: "none" as const };
                if (command.kind === "none") {
                  dispatch({ type: "nextTrack" });
                } else {
                  spotify.run(command);
                }
              }}
              onPreviousTrack={() => {
                const command = spotifyReady
                  ? planSkip(session, spotify.snapshot.trackUri, "previous")
                  : { kind: "none" as const };
                if (command.kind === "none") {
                  dispatch({ type: "previousTrack" });
                } else {
                  spotify.run(command);
                }
              }}
              onStop={() => {
                pauseSpotify();
                dispatch({ type: "stop" });
              }}
              onEject={() => {
                pauseSpotify();
                dispatch({ type: "ejectTape" });
              }}
              onVolumeChange={spotify.setVolumePercent}
            />
            <Sparkle owner="player" />
          </FloorItem>

          {/* Stays mounted while the player is empty so the card reappears where it was left. */}
          <FloorItem stageRef={stageRef}>
            {loadedTape ? (
              <JCard tape={loadedTape} trackIndex={session.trackIndex} />
            ) : null}
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
            <div className="floor-pill floor-hint">
              Drop a tape on the player to load it
            </div>
          </FloorItem>
          <FloorItem stageRef={stageRef}>
            <SpotifyPill
              status={spotify.status}
              failureDetail={spotify.failureDetail}
              notice={notice}
              onConnect={onConnectSpotify}
            />
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
              <div
                key={tape.date}
                className={
                  isCarried
                    ? "floor-tape-slot floor-tape-slot--carried"
                    : "floor-tape-slot"
                }
              >
                <FloorTape
                  tape={tape}
                  center={center}
                  lifted={false}
                  handlers={getTapeHandlers(tape.date, "floor")}
                />
              </div>
            );
          })}

          {drag && draggedTape ? (
            <FloorTape tape={draggedTape} center={drag.center} lifted={true} />
          ) : null}
        </main>
      </div>
    </div>
  );
}
