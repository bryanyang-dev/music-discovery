// Database ingestion limits. The RSS-only handler owns its shorter request budget.
export const INGESTION_TIMING = {
  maxWorkDurationMs: 240_000,
} as const;
