// Owns database client/transaction limits, not the run deadline or Supabase's pool.
// Keep lock < statement < operation timeout; timing.ts derives cleanup time here.
// Millisecond limits are enforced by our transaction/deadline code; the driver
// accepts connection/idle/close timeouts in seconds. See docs/timing-and-policies.md.
export const DATABASE_POLICY = {
  // Per client (currently one client per invocation), not a global concurrency cap.
  maxConnectionCount: 1,
  connectTimeoutSeconds: 5,
  // Close unused sockets; later operations may reconnect during the same run.
  idleTimeoutSeconds: 20,
  // Graceful close limit and fallback bound while waiting for forced termination.
  closeTimeoutSeconds: 3,
  // Abort/operation timeout tears down the driver without waiting for active work.
  forceCloseTimeoutSeconds: 0,
  // Set inside each transaction so limits also work through transaction pooling.
  statementTimeoutMs: 8_000,
  lockTimeoutMs: 2_000,
  // Bounds an entire database transaction, including connection acquisition.
  operationTimeoutMs: 15_000,
} as const;
