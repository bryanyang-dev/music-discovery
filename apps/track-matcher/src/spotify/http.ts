import { IngestionError } from "../../../../packages/shared/src/index.ts";

export const SPOTIFY_HTTP_POLICY = {
  requestTimeoutMs: 10_000,
  maxResponseBytes: 512_000,
} as const;

// All callers supply fixed Spotify endpoints. Redirects cannot forward credentials elsewhere.
export async function spotifyJson(
  fetcher: typeof fetch,
  url: string,
  init: RequestInit,
  signal: AbortSignal,
): Promise<unknown> {
  const requestSignal = AbortSignal.any([
    signal,
    AbortSignal.timeout(SPOTIFY_HTTP_POLICY.requestTimeoutMs),
  ]);
  try {
    const response = await fetcher(url, {
      ...init,
      signal: requestSignal,
      redirect: "error",
    });
    if (!response.ok) {
      await response.body?.cancel();
      if (response.status === 401 || response.status === 403) {
        throw new IngestionError("SPOTIFY_AUTH_ERROR");
      }
      if (response.status === 429) {
        throw new IngestionError("SPOTIFY_RATE_LIMITED");
      }
      throw new IngestionError("SPOTIFY_REQUEST_FAILED");
    }
    const reader = response.body?.getReader();
    if (!reader) {
      throw new IngestionError("SPOTIFY_REQUEST_FAILED");
    }
    const chunks: Uint8Array[] = [];
    let bytes = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        bytes += value.byteLength;
        if (bytes > SPOTIFY_HTTP_POLICY.maxResponseBytes) {
          throw new IngestionError("RESPONSE_TOO_LARGE");
        }
        chunks.push(value);
      }
    } finally {
      try {
        await reader.cancel();
      } catch {
        // Body disposal must not replace the original read/size failure.
      }
    }
    requestSignal.throwIfAborted();
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
  } catch (error) {
    if (signal.aborted) throw new IngestionError("RUN_DEADLINE");
    if (error instanceof IngestionError) throw error;
    throw new IngestionError("SPOTIFY_REQUEST_FAILED");
  }
}
