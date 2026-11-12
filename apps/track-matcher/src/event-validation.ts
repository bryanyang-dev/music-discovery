import { IngestionError } from "../../../packages/shared/src/index.ts";
import type { TrackMatcherEvent } from "./models.ts";

export function parseTrackMatcherEvent(event: unknown): TrackMatcherEvent {
  const id =
    event &&
    typeof event === "object" &&
    !Array.isArray(event) &&
    Object.hasOwn(event, "trackId")
      ? (event as { trackId: unknown }).trackId
      : undefined;
  if (
    typeof id !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)
  ) {
    throw new IngestionError("INVALID_TRACK_ID");
  }
  return { trackId: id };
}
