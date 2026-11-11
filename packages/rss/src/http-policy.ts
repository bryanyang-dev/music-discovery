// Owns reusable HTTP safety and retry limits for feed/review requests.
// The handler overrides feed attempts to 1 and owns its RSS retry loop/30 s cap;
// reviews and direct fetchFeed callers use these defaults. See docs/timing-and-policies.md.
export const HTTP_POLICY = {
  // Per attempt, including redirects and streaming the response body.
  requestTimeoutMs: 12_000,
  maxRedirectCount: 3,
  maxAttemptCount: 3,
  initialRetryDelayMs: 250,
  retryBackoffMultiplier: 2,
  // A longer Retry-After stops retries; it is never shortened to this value.
  maxRetryDelayMs: 10_000,
  // Limits apply to decompressed bodies; validators are bounded in characters.
  maxFeedResponseBytes: 2_000_000,
  maxReviewResponseBytes: 3_000_000,
  maxValidatorCharacters: 1_000,
} as const;
