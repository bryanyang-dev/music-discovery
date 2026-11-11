import { setTimeout as delay } from "node:timers/promises";
import { IngestionError, pitchforkUrl } from "@music-discovery/shared";
import { HTTP_POLICY } from "./http-policy.ts";

const MILLISECONDS_PER_SECOND = 1_000;
const REDIRECT_STATUS_CODES = new Set([301, 302, 303, 307, 308]);
const RETRYABLE_STATUS_CODES = new Set([408, 429, 500, 502, 503, 504]);

export interface HttpOptions {
  fetcher?: typeof fetch;
  signal?: AbortSignal;
  timeoutMs?: number;
  maxBytes?: number;
  attempts?: number;
  sleep?: (milliseconds: number, signal?: AbortSignal) => Promise<void>;
  now?: () => number;
}

export interface HttpResponse {
  status: number;
  body: string;
  url: string;
  etag: string | null;
  lastModified: string | null;
}

function retryAfterMs(value: string | null, nowMs: number): number | null {
  if (!value) {
    return null;
  }

  const isDelayInSeconds = /^\d+$/.test(value.trim());
  const milliseconds = isDelayInSeconds
    ? Number(value) * MILLISECONDS_PER_SECOND
    : Date.parse(value) - nowMs;

  return Number.isFinite(milliseconds) ? Math.max(0, milliseconds) : null;
}

function cacheValidator(value: string | null): string | null {
  if (!value || value.length > HTTP_POLICY.maxValidatorCharacters || /[\r\n]/.test(value)) {
    return null;
  }

  return value;
}

async function readResponseBody(
  response: Response,
  maxResponseBytes: number,
  signal: AbortSignal,
): Promise<string> {
  if (!response.body) {
    throw new IngestionError("HTTP_ERROR");
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let responseSizeBytes = 0;
  let readFailed = false;

  try {
    while (true) {
      signal.throwIfAborted();
      const chunk = await reader.read();
      if (chunk.done) {
        break;
      }

      responseSizeBytes += chunk.value.byteLength;
      if (responseSizeBytes > maxResponseBytes) {
        throw new IngestionError("RESPONSE_TOO_LARGE");
      }

      chunks.push(chunk.value);
    }
  } catch (error) {
    readFailed = true;
    throw error;
  } finally {
    try {
      await reader.cancel();
    } catch (error) {
      if (!readFailed) {
        throw error;
      }
    }
  }

  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks));
  } catch {
    throw new IngestionError("UNSUPPORTED_ENCODING");
  }
}

async function requestOnce(
  input: string,
  kind: "feed" | "review",
  headers: Record<string, string>,
  options: HttpOptions,
): Promise<HttpResponse> {
  const requestTimeoutSignal = AbortSignal.timeout(options.timeoutMs ?? HTTP_POLICY.requestTimeoutMs);
  const signal = options.signal
    ? AbortSignal.any([options.signal, requestTimeoutSignal])
    : requestTimeoutSignal;
  const defaultMaxResponseBytes = kind === "feed"
    ? HTTP_POLICY.maxFeedResponseBytes
    : HTTP_POLICY.maxReviewResponseBytes;
  const maxResponseBytes = options.maxBytes ?? defaultMaxResponseBytes;
  const fetcher = options.fetcher ?? fetch;
  let url = pitchforkUrl(input, kind);

  try {
    for (let redirectCount = 0; redirectCount <= HTTP_POLICY.maxRedirectCount; redirectCount++) {
      signal.throwIfAborted();
      const response = await fetcher(url, {
        method: "GET",
        redirect: "manual",
        signal,
        headers: {
          "User-Agent": "music-discovery/0.1 (hourly RSS ingestion)",
          Accept: kind === "feed" ? "application/rss+xml, application/xml, text/xml" : "text/html",
          ...headers,
        },
      });

      if (REDIRECT_STATUS_CODES.has(response.status)) {
        await response.body?.cancel();
        const location = response.headers.get("location");
        if (!location || redirectCount === HTTP_POLICY.maxRedirectCount) {
          throw new IngestionError("HTTP_ERROR");
        }

        url = pitchforkUrl(location, kind, url);
        continue;
      }

      const validators = {
        etag: cacheValidator(response.headers.get("etag")),
        lastModified: cacheValidator(response.headers.get("last-modified")),
      };
      if (response.status === 304 && kind === "feed") {
        await response.body?.cancel();
        return { status: 304, body: "", url, ...validators };
      }

      if (!response.ok) {
        await response.body?.cancel();
        let retryDelayMs: number | null = null;
        if (RETRYABLE_STATUS_CODES.has(response.status)) {
          const nowMs = (options.now ?? Date.now)();
          retryDelayMs = retryAfterMs(response.headers.get("retry-after"), nowMs) ?? 0;
        }

        throw new IngestionError("HTTP_ERROR", retryDelayMs);
      }

      const contentType = response.headers.get("content-type") ?? "";
      const unsupportedCharset = /charset\s*=\s*["']?(?!utf-?8\b|us-ascii\b)[\w-]+/i.test(contentType);
      if (unsupportedCharset) {
        await response.body?.cancel();
        throw new IngestionError("UNSUPPORTED_ENCODING");
      }

      const body = await readResponseBody(response, maxResponseBytes, signal);
      return { status: response.status, body, url, ...validators };
    }

    throw new IngestionError("HTTP_ERROR");
  } catch (error) {
    if (options.signal?.aborted) {
      throw new IngestionError("RUN_DEADLINE");
    }
    if (error instanceof IngestionError) {
      throw error;
    }

    const code = requestTimeoutSignal.aborted ? "REQUEST_TIMEOUT" : "NETWORK_ERROR";
    throw new IngestionError(code, 0);
  }
}

async function sleepBeforeRetry(milliseconds: number, signal?: AbortSignal): Promise<void> {
  await delay(milliseconds, undefined, signal ? { signal } : {});
}

export async function requestPitchfork(
  url: string,
  kind: "feed" | "review",
  headers: Record<string, string> = {},
  options: HttpOptions = {},
): Promise<HttpResponse> {
  const attemptCount = Math.max(1, Math.min(options.attempts ?? HTTP_POLICY.maxAttemptCount, HTTP_POLICY.maxAttemptCount));
  const sleep = options.sleep ?? sleepBeforeRetry;

  for (let attempt = 0; attempt < attemptCount; attempt++) {
    try {
      return await requestOnce(url, kind, headers, options);
    } catch (error) {
      const isLastAttempt = attempt === attemptCount - 1;
      if (!(error instanceof IngestionError) || error.retryAfterMs === null || isLastAttempt) {
        throw error;
      }

      const backoffMs = HTTP_POLICY.initialRetryDelayMs * HTTP_POLICY.retryBackoffMultiplier ** attempt;
      const retryDelayMs = Math.max(backoffMs, error.retryAfterMs);
      if (retryDelayMs > HTTP_POLICY.maxRetryDelayMs) {
        throw error;
      }

      try {
        await sleep(retryDelayMs, options.signal);
      } catch {
        throw new IngestionError("RUN_DEADLINE");
      }
    }
  }

  throw new IngestionError("HTTP_ERROR");
}

