import type { SourceDefinition } from "./models.ts";

export interface SourceRegistry {
  addSource(source: SourceDefinition): Promise<void>;
}
