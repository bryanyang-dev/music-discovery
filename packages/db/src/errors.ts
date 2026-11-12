import { IngestionError, type ErrorCode } from "@music-discovery/shared";

// Only recognized driver codes are inspected. Messages, SQL and parameters can
// contain credentials or row data and must never reach Lambda logs or responses.
const DATABASE_DRIVER_ERRORS: Readonly<Record<string, ErrorCode>> = {
  DEPTH_ZERO_SELF_SIGNED_CERT: "DATABASE_TLS_ERROR",
  SELF_SIGNED_CERT_IN_CHAIN: "DATABASE_TLS_ERROR",
  UNABLE_TO_VERIFY_LEAF_SIGNATURE: "DATABASE_TLS_ERROR",
  UNABLE_TO_GET_ISSUER_CERT: "DATABASE_TLS_ERROR",
  UNABLE_TO_GET_ISSUER_CERT_LOCALLY: "DATABASE_TLS_ERROR",
  CERT_HAS_EXPIRED: "DATABASE_TLS_ERROR",
  CERT_NOT_YET_VALID: "DATABASE_TLS_ERROR",
  ERR_TLS_CERT_ALTNAME_INVALID: "DATABASE_TLS_ERROR",
  ENOTFOUND: "DATABASE_DNS_ERROR",
  EAI_AGAIN: "DATABASE_DNS_ERROR",
  ECONNREFUSED: "DATABASE_CONNECTION_ERROR",
  ECONNRESET: "DATABASE_CONNECTION_ERROR",
  EPIPE: "DATABASE_CONNECTION_ERROR",
  ENETUNREACH: "DATABASE_CONNECTION_ERROR",
  EHOSTUNREACH: "DATABASE_CONNECTION_ERROR",
  CONNECTION_CLOSED: "DATABASE_CONNECTION_ERROR",
  CONNECTION_ENDED: "DATABASE_CONNECTION_ERROR",
  CONNECTION_DESTROYED: "DATABASE_CONNECTION_ERROR",
  ETIMEDOUT: "DATABASE_TIMEOUT",
  CONNECT_TIMEOUT: "DATABASE_TIMEOUT",
  "28000": "DATABASE_AUTH_ERROR",
  "28P01": "DATABASE_AUTH_ERROR",
  "42501": "DATABASE_PERMISSION_ERROR",
  "57014": "DATABASE_TIMEOUT",
  "55P03": "DATABASE_TIMEOUT",
  "3D000": "DATABASE_SCHEMA_ERROR",
  "3F000": "DATABASE_SCHEMA_ERROR",
  "42P01": "DATABASE_SCHEMA_ERROR",
  "42703": "DATABASE_SCHEMA_ERROR",
};

// Drizzle wraps driver errors in .cause. Bound traversal for cycles/deep wrappers.
const MAX_DATABASE_ERROR_CAUSE_DEPTH = 5;

export function databaseError(error: unknown): IngestionError {
  let cause = error;
  for (let depth = 0; depth < MAX_DATABASE_ERROR_CAUSE_DEPTH; depth++) {
    if (cause instanceof IngestionError) {
      return cause;
    }
    if (cause === null || typeof cause !== "object") {
      break;
    }
    const details = cause as { code?: unknown; cause?: unknown };
    if (typeof details.code === "string") {
      const code = Object.hasOwn(DATABASE_DRIVER_ERRORS, details.code)
        ? DATABASE_DRIVER_ERRORS[details.code]
        : undefined;
      if (code) {
        return new IngestionError(code);
      }
      if (/^08[A-Z0-9]{3}$/.test(details.code)) {
        return new IngestionError("DATABASE_CONNECTION_ERROR");
      }
    }
    cause = details.cause;
  }
  return new IngestionError("DATABASE_ERROR");
}
