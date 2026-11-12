import { useRef, useState, type PointerEvent, type RefObject } from "react";
import type { FloorPosition } from "./models.ts";
import { stageWidthPx, toStagePoint } from "./use-stage-scale.ts";

/** Pointer travel before a press on a tape becomes a drag instead of a click. */
const dragStartThresholdPx = 4;

/** A tape lifted off the floor or out of the box; `center` is the cassette's centre in artboard pixels. */
export interface TapeDrag {
  readonly tapeDate: string;
  readonly center: FloorPosition;
}

/** Where a dragged tape was let go. */
export type TapeDropTarget = "player" | "box" | "floor";

/** Where a tape was picked up from. A floor tape keeps the grip point; a boxed tape is carried by its centre. */
export type TapeOrigin = "box" | "floor";

export interface TapeDragHandlers {
  readonly onPointerDown: (event: PointerEvent<HTMLButtonElement>) => void;
  readonly onPointerMove: (event: PointerEvent<HTMLButtonElement>) => void;
  readonly onPointerUp: (event: PointerEvent<HTMLButtonElement>) => void;
  readonly onPointerCancel: () => void;
  readonly onLostPointerCapture: () => void;
  readonly onClick: () => void;
}

interface PendingPress {
  readonly tapeDate: string;
  readonly pointerId: number;
  readonly startX: number;
  readonly startY: number;
  /** Pointer position minus cassette centre, in artboard pixels. */
  readonly gripOffset: FloorPosition;
  dragged: boolean;
}

interface UseTapeDragOptions {
  readonly stageRef: RefObject<HTMLElement | null>;
  readonly playerRef: RefObject<HTMLElement | null>;
  readonly boxRef: RefObject<HTMLElement | null>;
  /** A tape was dragged and released; `center` is where the cassette's centre ended up. */
  readonly onDropTape: (tapeDate: string, target: TapeDropTarget, center: FloorPosition) => void;
  /** A tape was clicked or activated from the keyboard without dragging. */
  readonly onActivateTape: (tapeDate: string) => void;
}

interface UseTapeDragResult {
  readonly drag: TapeDrag | null;
  readonly getTapeHandlers: (tapeDate: string, origin: TapeOrigin) => TapeDragHandlers;
}

function containsPoint(element: HTMLElement | null, clientX: number, clientY: number): boolean {
  if (!element) {
    return false;
  }
  const rect = element.getBoundingClientRect();
  return clientX >= rect.left && clientX <= rect.right && clientY >= rect.top && clientY <= rect.bottom;
}

/**
 * Lets a tape be dragged between the box, the floor and the player. A plain
 * click or keyboard activation is reported separately, so dragging is never required.
 */
export function useTapeDrag({
  stageRef,
  playerRef,
  boxRef,
  onDropTape,
  onActivateTape,
}: UseTapeDragOptions): UseTapeDragResult {
  const [drag, setDrag] = useState<TapeDrag | null>(null);
  const pendingPress = useRef<PendingPress | null>(null);
  const suppressNextClick = useRef(false);

  function stageScale(stage: HTMLElement): number {
    return stage.getBoundingClientRect().width / stageWidthPx;
  }

  function tapeCenter(press: PendingPress, clientX: number, clientY: number): FloorPosition | null {
    const stage = stageRef.current;
    if (!stage) {
      return null;
    }
    const point = toStagePoint(stage, clientX, clientY);
    return { x: point.x - press.gripOffset.x, y: point.y - press.gripOffset.y };
  }

  function abandonPress() {
    pendingPress.current = null;
    setDrag(null);
  }

  function getTapeHandlers(tapeDate: string, origin: TapeOrigin): TapeDragHandlers {
    return {
      onPointerDown(event) {
        suppressNextClick.current = false;
        if (event.button !== 0) {
          return;
        }

        let gripOffset: FloorPosition = { x: 0, y: 0 };
        const stage = stageRef.current;
        if (origin === "floor" && stage) {
          // Rotation does not move an element's centre, so the bounding box centre is the cassette centre.
          const tapeRect = event.currentTarget.getBoundingClientRect();
          const scale = stageScale(stage);
          gripOffset = {
            x: (event.clientX - (tapeRect.left + tapeRect.width / 2)) / scale,
            y: (event.clientY - (tapeRect.top + tapeRect.height / 2)) / scale,
          };
        }

        pendingPress.current = {
          tapeDate,
          pointerId: event.pointerId,
          startX: event.clientX,
          startY: event.clientY,
          gripOffset,
          dragged: false,
        };
        event.currentTarget.setPointerCapture(event.pointerId);
      },

      onPointerMove(event) {
        const press = pendingPress.current;
        if (!press || press.pointerId !== event.pointerId) {
          return;
        }
        if (!press.dragged) {
          const travelPx = Math.hypot(event.clientX - press.startX, event.clientY - press.startY);
          if (travelPx < dragStartThresholdPx) {
            return;
          }
          press.dragged = true;
        }
        const center = tapeCenter(press, event.clientX, event.clientY);
        if (center) {
          setDrag({ tapeDate: press.tapeDate, center });
        }
      },

      onPointerUp(event) {
        const press = pendingPress.current;
        pendingPress.current = null;
        if (!press || !press.dragged) {
          return;
        }
        // The browser still fires a click after a drag; that click must not activate the tape.
        suppressNextClick.current = true;
        setDrag(null);

        const center = tapeCenter(press, event.clientX, event.clientY);
        if (!center) {
          return;
        }
        let target: TapeDropTarget = "floor";
        if (containsPoint(playerRef.current, event.clientX, event.clientY)) {
          target = "player";
        } else if (containsPoint(boxRef.current, event.clientX, event.clientY)) {
          target = "box";
        }
        onDropTape(press.tapeDate, target, center);
      },

      onPointerCancel: abandonPress,

      // If the browser takes the pointer away mid-drag, put the tape back where it was.
      onLostPointerCapture() {
        if (pendingPress.current) {
          abandonPress();
        }
      },

      onClick() {
        if (suppressNextClick.current) {
          suppressNextClick.current = false;
          return;
        }
        onActivateTape(tapeDate);
      },
    };
  }

  return { drag, getTapeHandlers };
}
