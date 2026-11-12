import { useRef, useState, type PointerEvent, type RefObject } from "react";
import { stageWidthPx } from "./use-stage-scale.ts";

/** Pointer travel before a press on a boxed tape becomes a drag instead of a click. */
const dragStartThresholdPx = 4;

/** A tape lifted off the floor; `x`/`y` are the pointer position in artboard pixels. */
export interface TapeDrag {
  readonly tapeDate: string;
  readonly x: number;
  readonly y: number;
}

export interface TapeSlotHandlers {
  readonly onPointerDown: (event: PointerEvent<HTMLButtonElement>) => void;
  readonly onPointerMove: (event: PointerEvent<HTMLButtonElement>) => void;
  readonly onPointerUp: (event: PointerEvent<HTMLButtonElement>) => void;
  readonly onPointerCancel: () => void;
  readonly onClick: () => void;
}

interface PendingPress {
  readonly tapeDate: string;
  readonly pointerId: number;
  readonly startX: number;
  readonly startY: number;
  dragged: boolean;
}

interface UseTapeDragOptions {
  readonly stageRef: RefObject<HTMLElement | null>;
  readonly playerRef: RefObject<HTMLElement | null>;
  readonly onLoadTape: (tapeDate: string) => void;
}

interface UseTapeDragResult {
  readonly drag: TapeDrag | null;
  readonly getSlotHandlers: (tapeDate: string) => TapeSlotHandlers;
}

/**
 * Lets a boxed tape be dragged onto the player to load it. A plain click or
 * keyboard activation loads it directly, so dragging is never required.
 */
export function useTapeDrag({ stageRef, playerRef, onLoadTape }: UseTapeDragOptions): UseTapeDragResult {
  const [drag, setDrag] = useState<TapeDrag | null>(null);
  const pendingPress = useRef<PendingPress | null>(null);
  const suppressNextClick = useRef(false);

  function toStagePoint(clientX: number, clientY: number): { x: number; y: number } | null {
    const stage = stageRef.current;
    if (!stage) {
      return null;
    }
    const stageRect = stage.getBoundingClientRect();
    const scale = stageRect.width / stageWidthPx;
    return { x: (clientX - stageRect.left) / scale, y: (clientY - stageRect.top) / scale };
  }

  function isOverPlayer(clientX: number, clientY: number): boolean {
    const player = playerRef.current;
    if (!player) {
      return false;
    }
    const playerRect = player.getBoundingClientRect();
    return (
      clientX >= playerRect.left &&
      clientX <= playerRect.right &&
      clientY >= playerRect.top &&
      clientY <= playerRect.bottom
    );
  }

  function getSlotHandlers(tapeDate: string): TapeSlotHandlers {
    return {
      onPointerDown(event) {
        suppressNextClick.current = false;
        if (event.button !== 0) {
          return;
        }
        pendingPress.current = {
          tapeDate,
          pointerId: event.pointerId,
          startX: event.clientX,
          startY: event.clientY,
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
        const point = toStagePoint(event.clientX, event.clientY);
        if (point) {
          setDrag({ tapeDate: press.tapeDate, x: point.x, y: point.y });
        }
      },

      onPointerUp(event) {
        const press = pendingPress.current;
        pendingPress.current = null;
        if (!press || !press.dragged) {
          return;
        }
        // The browser still fires a click after a drag; that click must not load the tape.
        suppressNextClick.current = true;
        setDrag(null);
        if (isOverPlayer(event.clientX, event.clientY)) {
          onLoadTape(press.tapeDate);
        }
      },

      onPointerCancel() {
        pendingPress.current = null;
        setDrag(null);
      },

      onClick() {
        if (suppressNextClick.current) {
          suppressNextClick.current = false;
          return;
        }
        onLoadTape(tapeDate);
      },
    };
  }

  return { drag, getSlotHandlers };
}
