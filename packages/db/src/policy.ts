export const DATABASE_POLICY = {
  maxConnectionCount: 1,
  connectTimeoutSeconds: 5,
  idleTimeoutSeconds: 20,
  closeTimeoutSeconds: 3,
  forceCloseTimeoutSeconds: 0,
  statementTimeoutMs: 8_000,
  lockTimeoutMs: 2_000,
  operationTimeoutMs: 15_000,
  minimumLeaseSeconds: 30,
  maximumLeaseSeconds: 600,
} as const;
