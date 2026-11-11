import { DATABASE_POLICY } from "@music-discovery/db";

export const INGESTION_TIMING = {
  maxWorkDurationMs: 240_000,
  // An aborted DB operation may need termination, then run finalization and close.
  cleanupReserveMs: DATABASE_POLICY.operationTimeoutMs
    + 3 * DATABASE_POLICY.closeTimeoutSeconds * 1_000 + 250,
} as const;
