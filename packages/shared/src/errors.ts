// Messages are fixed application text; never interpolate URLs, SQL or driver messages.
export const INGESTION_ERROR_MESSAGES = {
  INVALID_TRACK_ID: "The event must include a valid trackId UUID.",
  TRACK_NOT_FOUND: "The requested track does not exist.",
  TRACK_CHANGED:
    "The track title or artists changed during matching; retry with current metadata.",
  SPOTIFY_CONFIG_INVALID:
    "Configure SPOTIFY_CLIENT_ID, SPOTIFY_CLIENT_SECRET and a two-letter SPOTIFY_MARKET.",
  SPOTIFY_AUTH_ERROR:
    "Spotify rejected the application credentials or access token.",
  SPOTIFY_RATE_LIMITED: "Spotify rate limited the request; retry later.",
  SPOTIFY_REQUEST_FAILED:
    "The Spotify request failed or returned an invalid response.",
  UNSAFE_URL:
    "The URL is not allowed by the selected source policy or contains credentials.",
  HTTP_ERROR: "The source returned an unsuccessful HTTP response.",
  NETWORK_ERROR: "The request to the source failed due to a network error.",
  REQUEST_TIMEOUT: "The request to the source exceeded its time limit.",
  RESPONSE_TOO_LARGE: "The response exceeded the allowed decompressed size.",
  UNSUPPORTED_ENCODING:
    "The feed or response uses an unsupported text encoding.",
  INVALID_FEED: "The response is not a valid RSS feed for the selected source.",
  INVALID_ENTRY:
    "The feed entry or track is missing required fields or contains invalid values.",
  MISSING_METADATA: "The review is missing the track title or artist metadata.",
  INVALID_METADATA:
    "The review metadata is invalid or does not match this track review.",
  DATABASE_ERROR:
    "The database operation failed for an unclassified reason. Check database diagnostics.",
  DATABASE_CONFIG_MISSING:
    "DATABASE_URL is missing or empty in the runtime environment.",
  DATABASE_CONFIG_INVALID:
    "DATABASE_URL must be a valid PostgreSQL connection URL; local TLS bypass is allowed only on loopback.",
  DATABASE_TLS_ERROR:
    "Database TLS verification failed. Check the server certificate and NODE_EXTRA_CA_CERTS trusted CA file.",
  DATABASE_AUTH_ERROR:
    "Database authentication failed. Check the runtime database username and password.",
  DATABASE_PERMISSION_ERROR:
    "The database role lacks permission for this operation. Check table grants and row-level security policies.",
  DATABASE_DNS_ERROR:
    "The database hostname could not be resolved. Check DATABASE_URL and DNS connectivity.",
  DATABASE_CONNECTION_ERROR:
    "The database connection failed or was closed. Check the host, port, database availability and network access.",
  DATABASE_TIMEOUT:
    "A database connection, query or lock exceeded its time limit, or the server canceled the query.",
  DATABASE_SCHEMA_ERROR:
    "The configured database, schema, table or column does not exist. Check the database target and applied migrations.",
  SOURCE_NOT_FOUND:
    "The requested ingestion source is missing from the database. Check its registration.",
  INVALID_SOURCE:
    "The source configuration or requested source key is invalid.",
  UNSUPPORTED_SOURCE:
    "No ingestion adapter supports this source name and category.",
  SOURCE_ALREADY_EXISTS:
    "An ingestion source with this key is already registered.",
  RUN_DEADLINE:
    "The ingestion work deadline was reached; processing stopped to leave time for cleanup.",
} as const;

export type ErrorCode = keyof typeof INGESTION_ERROR_MESSAGES;

export class IngestionError extends Error {
  readonly code: ErrorCode;
  readonly retryAfterMs: number | null;
  readonly cleanupErrors: ErrorCode[] = [];
  constructor(code: ErrorCode, retryAfterMs: number | null = null) {
    super(`${code}: ${INGESTION_ERROR_MESSAGES[code]}`);
    this.name = "IngestionError";
    this.code = code;
    this.retryAfterMs = retryAfterMs;
  }
}

export function errorCode(
  error: unknown,
  fallback: ErrorCode = "DATABASE_ERROR",
): ErrorCode {
  return error instanceof IngestionError ? error.code : fallback;
}

export function toIngestionError(error: unknown): IngestionError {
  if (error instanceof IngestionError) {
    return error;
  }

  return new IngestionError(errorCode(error));
}
