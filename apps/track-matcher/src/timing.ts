import { DATABASE_POLICY } from "../../../packages/db/src/index.ts";

export const MATCHER_TIMING = {
  maxWorkDurationMs: 120_000,
  cleanupReserveMs: DATABASE_POLICY.operationTimeoutMs + DATABASE_POLICY.closeTimeoutSeconds * 1_000 + 250,
} as const;
