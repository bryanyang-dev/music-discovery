import {
  IngestionError,
  validateSourceDefinition,
  type SourceDefinition,
} from "@music-discovery/shared";
import { pitchforkAdapter } from "./publishers/pitchfork/adapter.ts";
import type { SourceAdapter } from "./source-adapter.interface.ts";

export function getSourceAdapter(input: SourceDefinition): SourceAdapter {
  const source = validateSourceDefinition(input);
  if (source.name !== "pitchfork") {
    throw new IngestionError("UNSUPPORTED_SOURCE");
  }
  pitchforkAdapter.validateSource(source);
  return pitchforkAdapter;
}
