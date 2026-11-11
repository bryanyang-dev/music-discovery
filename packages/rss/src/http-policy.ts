export const HTTP_POLICY = {
  requestTimeoutMs: 12_000,
  maxRedirectCount: 3,
  maxAttemptCount: 3,
  initialRetryDelayMs: 250,
  retryBackoffMultiplier: 2,
  maxRetryDelayMs: 10_000,
  maxFeedResponseBytes: 2_000_000,
  maxReviewResponseBytes: 3_000_000,
  maxValidatorCharacters: 1_000,
} as const;
