import { IngestionError } from "./errors.ts";
import type { SourceDefinition } from "./models.ts";

export function validateSourceKey(value: unknown): string {
  if (typeof value !== "string" || !/^[a-z][a-z0-9_-]{0,99}$/.test(value)) {
    throw new IngestionError("INVALID_SOURCE");
  }
  return value;
}

export function validateSourceDefinition(source: SourceDefinition): SourceDefinition {
  validateSourceKey(source.key);
  for (const value of [source.name, source.category]) {
    validateSourceKey(value);
  }
  let url: URL;
  try {
    url = new URL(source.feedUrl);
  } catch {
    throw new IngestionError("INVALID_SOURCE");
  }
  if (url.protocol !== "https:" || url.username || url.password || url.port || url.hash) {
    throw new IngestionError("INVALID_SOURCE");
  }
  return { key: source.key, name: source.name, category: source.category, feedUrl: url.href };
}
