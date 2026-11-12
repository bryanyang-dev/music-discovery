import { useLayoutEffect, useState, type RefObject } from "react";

/** The scene is drawn on a fixed artboard and scaled as a whole to fit its container. */
export const stageWidthPx = 1440;
export const stageHeightPx = 900;

/** Converts a viewport point to artboard pixels, whatever the stage's current scale. */
export function toStagePoint(
  stage: HTMLElement,
  clientX: number,
  clientY: number,
): { x: number; y: number } {
  const stageRect = stage.getBoundingClientRect();
  const scale = stageRect.width / stageWidthPx;
  return {
    x: (clientX - stageRect.left) / scale,
    y: (clientY - stageRect.top) / scale,
  };
}

function fitScale(container: HTMLElement): number {
  return Math.min(
    container.clientWidth / stageWidthPx,
    container.clientHeight / stageHeightPx,
  );
}

/** Returns the scale that fits the artboard inside `containerRef`, updated whenever the container resizes. */
export function useStageScale(
  containerRef: RefObject<HTMLElement | null>,
): number {
  const [scale, setScale] = useState(1);

  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }
    setScale(fitScale(container));

    const observer = new ResizeObserver(() => {
      setScale(fitScale(container));
    });
    observer.observe(container);
    return () => {
      observer.disconnect();
    };
  }, [containerRef]);

  return scale;
}
