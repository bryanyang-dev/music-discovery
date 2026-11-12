import { IngestionError, validateSourceKey } from "@music-discovery/shared";
import type { IngestionEvent } from "./models.ts";

export function parseIngestionEvent(event: unknown): IngestionEvent {
  if (
    event === null ||
    typeof event !== "object" ||
    Array.isArray(event) ||
    !Object.hasOwn(event, "sourceKey")
  ) {
    throw new IngestionError("INVALID_SOURCE");
  }
  return {
    sourceKey: validateSourceKey((event as { sourceKey: unknown }).sourceKey),
  };
}
