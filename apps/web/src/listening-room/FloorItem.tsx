import { useEffect, useRef, useState, type MouseEvent, type PointerEvent, type ReactNode, type RefObject } from "react";
import type { FloorPosition } from "./models.ts";
import { stageHeightPx, stageWidthPx, toStagePoint } from "./use-stage-scale.ts";

/** Pointer travel before a press on an item becomes a drag instead of a click. */
const dragStartThresholdPx = 4;
/** The grip point is kept this far inside the artboard, so a moved item can always be grabbed again. */
const stageEdgeMarginPx = 20;

const controlSelector = "button, input, a";

interface FloorItemProps {
  readonly stageRef: RefObject<HTMLElement | null>;
  /**
   * "body": presses on buttons and inputs inside the item keep their own behaviour and do not move it.
   * "anywhere": the item is itself a control (the lamp); dragging moves it and a plain click still activates it.
   */
  readonly dragHandle?: "body" | "anywhere";
  readonly children: ReactNode;
}

function clampToStage(point: FloorPosition): FloorPosition {
  return {
    x: Math.min(Math.max(point.x, stageEdgeMarginPx), stageWidthPx - stageEdgeMarginPx),
    y: Math.min(Math.max(point.y, stageEdgeMarginPx), stageHeightPx - stageEdgeMarginPx),
  };
}

/** Wraps an object on the floor so it can be dragged around the mat. Its children keep their artboard positions. */
export function FloorItem({ stageRef, dragHandle = "body", children }: FloorItemProps) {
  const [offset, setOffset] = useState<FloorPosition>({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const suppressNextClick = useRef(false);
  const stopTracking = useRef<(() => void) | null>(null);

  useEffect(() => {
    return () => {
      stopTracking.current?.();
    };
  }, []);

  function handlePointerDown(event: PointerEvent<HTMLDivElement>) {
    suppressNextClick.current = false;
    if (event.button !== 0 || stopTracking.current) {
      return;
    }
    const pressedControl = event.target instanceof Element && event.target.closest(controlSelector) !== null;
    if (pressedControl && dragHandle === "body") {
      return;
    }
    const stage = stageRef.current;
    if (!stage) {
      return;
    }

    const pointerId = event.pointerId;
    const startClient = { x: event.clientX, y: event.clientY };
    const startPoint = toStagePoint(stage, event.clientX, event.clientY);
    const startOffset = offset;
    let dragged = false;

    const handleMove = (moveEvent: globalThis.PointerEvent) => {
      if (moveEvent.pointerId !== pointerId) {
        return;
      }
      if (!dragged) {
        const travelPx = Math.hypot(moveEvent.clientX - startClient.x, moveEvent.clientY - startClient.y);
        if (travelPx < dragStartThresholdPx) {
          return;
        }
        dragged = true;
        setDragging(true);
      }
      const point = clampToStage(toStagePoint(stage, moveEvent.clientX, moveEvent.clientY));
      setOffset({ x: startOffset.x + point.x - startPoint.x, y: startOffset.y + point.y - startPoint.y });
    };

    function handleEnd(endEvent: globalThis.PointerEvent) {
      if (endEvent.pointerId !== pointerId) {
        return;
      }
      stopTracking.current?.();
      if (dragged) {
        // The browser still fires a click after a drag; it must not activate a control inside the item.
        suppressNextClick.current = true;
        setDragging(false);
      }
    }

    // Track on the window so the drag continues when the pointer outruns the item.
    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", handleEnd);
    window.addEventListener("pointercancel", handleEnd);
    stopTracking.current = () => {
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", handleEnd);
      window.removeEventListener("pointercancel", handleEnd);
      stopTracking.current = null;
    };
  }

  function handleClickCapture(event: MouseEvent<HTMLDivElement>) {
    if (suppressNextClick.current) {
      suppressNextClick.current = false;
      event.stopPropagation();
      event.preventDefault();
    }
  }

  return (
    <div
      className={dragging ? "floor-item floor-item--dragging" : "floor-item"}
      style={{ transform: `translate(${offset.x}px, ${offset.y}px)` }}
      onPointerDown={handlePointerDown}
      onClickCapture={handleClickCapture}
    >
      {children}
    </div>
  );
}
