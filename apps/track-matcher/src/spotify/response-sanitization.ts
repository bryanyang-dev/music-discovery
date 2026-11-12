import { safeLogUrl } from "../../../../packages/shared/src/index.ts";

export const SPOTIFY_RESPONSE_LOG_LIMITS = {
  maxArrayItems: 10,
  maxStringCharacters: 512,
  maxDepth: 8,
  maxResponseBytes: 32_000,
} as const;

// Public catalog fields only. Unknown fields and arbitrary error text are excluded.
const PUBLIC_FIELDS = new Set([
  "tracks",
  "items",
  "href",
  "limit",
  "next",
  "offset",
  "previous",
  "total",
  "album",
  "album_type",
  "total_tracks",
  "available_markets",
  "external_urls",
  "spotify",
  "id",
  "images",
  "url",
  "height",
  "width",
  "name",
  "release_date",
  "release_date_precision",
  "restrictions",
  "reason",
  "type",
  "uri",
  "artists",
  "disc_number",
  "duration_ms",
  "explicit",
  "external_ids",
  "isrc",
  "ean",
  "upc",
  "is_playable",
  "linked_from",
  "popularity",
  "preview_url",
  "track_number",
  "is_local",
  "token_type",
  "expires_in",
]);
const URL_FIELDS = new Set([
  "href",
  "next",
  "previous",
  "url",
  "spotify",
  "preview_url",
]);

export function sanitizeSpotifyResponse(
  result: unknown,
  operation: "token" | "search",
): Record<string, unknown> {
  if (operation === "token") {
    const token = result as {
      expires_in?: unknown;
      token_type?: unknown;
    } | null;
    return {
      response: {
        ...(typeof token?.expires_in === "number"
          ? { expires_in: token.expires_in }
          : {}),
        ...(token?.token_type === "Bearer" ? { token_type: "Bearer" } : {}),
      },
      responseTruncated: false,
    };
  }
  let truncated = false;
  function visit(value: unknown, depth: number): unknown {
    if (depth > SPOTIFY_RESPONSE_LOG_LIMITS.maxDepth) {
      truncated = true;
      return "[truncated]";
    }
    if (
      value === null ||
      typeof value === "number" ||
      typeof value === "boolean"
    ) {
      return value;
    }
    if (typeof value === "string") {
      if (value.length > SPOTIFY_RESPONSE_LOG_LIMITS.maxStringCharacters) {
        truncated = true;
      }
      return value.slice(0, SPOTIFY_RESPONSE_LOG_LIMITS.maxStringCharacters);
    }
    if (Array.isArray(value)) {
      if (value.length > SPOTIFY_RESPONSE_LOG_LIMITS.maxArrayItems) {
        truncated = true;
      }
      return value
        .slice(0, SPOTIFY_RESPONSE_LOG_LIMITS.maxArrayItems)
        .map((item) => visit(item, depth + 1));
    }
    if (typeof value !== "object") {
      return "[redacted]";
    }
    const output: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      if (key === "error") {
        const error = item as { status?: unknown } | null;
        output.error =
          typeof error?.status === "number" ? { status: error.status } : {};
        continue;
      }
      if (!PUBLIC_FIELDS.has(key)) {
        // Do not copy untrusted property names into logs either.
        continue;
      }
      if (URL_FIELDS.has(key) && typeof item === "string") {
        output[key] = visit(safeLogUrl(item) ?? "[redacted]", depth + 1);
      } else {
        output[key] = visit(item, depth + 1);
      }
    }
    return output;
  }
  // An arbitrary top-level string (including non-JSON provider error text) is unsafe.
  let response =
    result !== null && typeof result === "object"
      ? visit(result, 0)
      : "[redacted]";
  if (
    Buffer.byteLength(JSON.stringify(response), "utf8") >
    SPOTIFY_RESPONSE_LOG_LIMITS.maxResponseBytes
  ) {
    response = "[response omitted: exceeds log size limit]";
    truncated = true;
  }
  return { response, responseTruncated: truncated };
}
