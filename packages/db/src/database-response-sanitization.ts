import { INGESTION_ERROR_MESSAGES, safeLogUrl } from "@music-discovery/shared";

export const DATABASE_RESPONSE_LOG_LIMITS = {
  maxRows: 10,
  maxArrayItems: 10,
  maxStringCharacters: 512,
  maxResponseBytes: 16_000,
} as const;

const TEXT_FIELDS = [
  "id", "sourceId", "runId", "key", "name", "category", "trackTitle", "reviewTitle",
  "reviewAuthor", "summary", "metadataHash", "releaseDate", "providerTrackId", "providerTitle",
] as const;
const DATE_FIELDS = ["lastAttemptAt", "lastSuccessAt", "createdAt", "startedAt", "finishedAt",
  "reviewPublishedAt", "firstSeenAt", "lastSeenAt", "updatedAt", "matchedAt"] as const;
const URL_FIELDS = ["feedUrl", "sourceUrl", "imageUrl", "providerUrl"] as const;
const COUNT_FIELDS = ["found", "inserted", "updated", "unchanged", "rejected"] as const;
const RUN_STATUSES = new Set(["running", "succeeded", "partial_failure", "failed", "skipped"]);
const MATCH_STATUSES = new Set(["pending", "matched", "not_found", "ambiguous"]);
const WRITE_OUTCOMES = new Set(["inserted", "updated", "unchanged"]);
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function sanitizeDatabaseResponse(operation: string, result: unknown): Record<string, unknown> {
  let truncated = false;
  function text(value: string): string {
    if (value.length > DATABASE_RESPONSE_LOG_LIMITS.maxStringCharacters) {
      truncated = true;
    }
    return value.slice(0, DATABASE_RESPONSE_LOG_LIMITS.maxStringCharacters);
  }
  function limitedItems(value: unknown[]): unknown[] {
    if (value.length > DATABASE_RESPONSE_LOG_LIMITS.maxArrayItems) {
      truncated = true;
    }
    return value.slice(0, DATABASE_RESPONSE_LOG_LIMITS.maxArrayItems);
  }
  function row(value: unknown): Record<string, unknown> {
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
      return {};
    }
    const input = value as Record<string, unknown>;
    const output: Record<string, unknown> = {};
    for (const key of TEXT_FIELDS) {
      if (typeof input[key] === "string") {
        output[key] = text(input[key]);
      } else if (input[key] === null) {
        output[key] = null;
      }
    }
    for (const key of DATE_FIELDS) {
      const date = input[key];
      if (date instanceof Date) {
        output[key] = Number.isFinite(date.getTime()) ? date.toISOString() : null;
      } else if (date === null) {
        output[key] = null;
      }
    }
    for (const key of URL_FIELDS) {
      const url = input[key];
      if (typeof url === "string") {
        output[key] = text(safeLogUrl(url) ?? "[redacted]");
      } else if (url === null) {
        output[key] = null;
      }
    }
    for (const key of ["etag", "lastModified", "sourceGuid"] as const) {
      if (Object.hasOwn(input, key)) {
        output[key] = input[key] === null ? null : "[redacted]";
      }
    }
    for (const key of ["artists", "genres", "labels", "providerArtists"] as const) {
      if (Array.isArray(input[key])) {
        output[key] = limitedItems(input[key]).filter(item => typeof item === "string").map(text);
      }
    }
    for (const key of ["enabled", "notModified"] as const) {
      if (typeof input[key] === "boolean") {
        output[key] = input[key];
      }
    }
    for (const key of COUNT_FIELDS) {
      if (typeof input[key] === "number" && Number.isFinite(input[key])) {
        output[key] = input[key];
      }
    }
    if (typeof input.status === "string" && RUN_STATUSES.has(input.status)) {
      output.status = input.status;
    }
    if (typeof input.matchStatus === "string" && MATCH_STATUSES.has(input.matchStatus)) {
      output.matchStatus = input.matchStatus;
    }
    if (typeof input.status === "string" && MATCH_STATUSES.has(input.status)) {
      output.status = input.status;
    }
    if (Object.hasOwn(input, "lastErrorCode")) {
      if (input.lastErrorCode === null) {
        output.lastErrorCode = null;
      } else if (typeof input.lastErrorCode === "string" && Object.hasOwn(INGESTION_ERROR_MESSAGES, input.lastErrorCode)) {
        output.lastErrorCode = input.lastErrorCode;
      } else {
        output.lastErrorCode = "[redacted]";
      }
    }
    if (Array.isArray(input.errors)) {
      output.errors = limitedItems(input.errors).map(issue => {
        if (issue === null || typeof issue !== "object") {
          return {};
        }
        const { code, sourceUrl } = issue as Record<string, unknown>;
        return {
          code: typeof code === "string" && Object.hasOwn(INGESTION_ERROR_MESSAGES, code) ? code : "[redacted]",
          sourceUrl: typeof sourceUrl === "string" ? text(safeLogUrl(sourceUrl) ?? "[redacted]") : null,
        };
      });
    }
    if (["set_statement_timeout", "set_lock_timeout"].includes(operation)
      && typeof input.set_config === "string" && /^\d{1,10}$/.test(input.set_config)) {
      output.set_config = input.set_config;
    }
    return output;
  }

  let response: unknown;
  if (Array.isArray(result)) {
    truncated = result.length > DATABASE_RESPONSE_LOG_LIMITS.maxRows;
    response = result.slice(0, DATABASE_RESPONSE_LOG_LIMITS.maxRows).map(row);
  } else if (result === undefined || result === null) {
    response = null;
  } else if (typeof result === "string") {
    response = WRITE_OUTCOMES.has(result) || (operation === "beginRun" && UUID_PATTERN.test(result))
      ? result : "[redacted]";
  } else {
    response = row(result);
  }
  if (Buffer.byteLength(JSON.stringify(response), "utf8") > DATABASE_RESPONSE_LOG_LIMITS.maxResponseBytes) {
    response = "[response omitted: exceeds log size limit]";
    truncated = true;
  }
  return { response, responseTruncated: truncated };
}
