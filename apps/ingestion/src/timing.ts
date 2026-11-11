import { DATABASE_POLICY } from "@music-discovery/db";

// Owns the whole ingestion run's work/cleanup budget, not individual I/O timeouts.
// The handler caps work at min(maxWorkDurationMs, Lambda remaining - cleanupReserveMs).
// This does not configure Lambda's timeout; maintain that setting in the console.
// See docs/timing-and-policies.md for the nested deadlines and tuning guidance.
export const INGESTION_TIMING = {
  maxWorkDurationMs: 240_000,
  // Reserve: work termination + finalization (including termination if it stalls)
  // + normal connection close + 250 ms for logging/return = 24,250 ms.
  cleanupReserveMs: DATABASE_POLICY.operationTimeoutMs
    + 3 * DATABASE_POLICY.closeTimeoutSeconds * 1_000 + 250,
} as const;
