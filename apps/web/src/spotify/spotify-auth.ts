/**
 * Spotify sign-in for a single local user: authorization code flow with PKCE,
 * run entirely in the browser. Tokens stay in this browser's storage; the
 * local API never sees them.
 */

export const SPOTIFY_AUTH_POLICY = {
  /** Refresh the access token when it has less than this long left. */
  tokenRefreshMarginSeconds: 120,
} as const;

/**
 * Web Playback SDK needs the first three; starting playback needs
 * `user-modify-playback-state`; listing devices (for diagnosing a device
 * Spotify does not know) needs `user-read-playback-state`.
 */
export const spotifyScopes = [
  "streaming",
  "user-read-email",
  "user-read-private",
  "user-modify-playback-state",
  "user-read-playback-state",
] as const;

const authorizeUrl = "https://accounts.spotify.com/authorize";
const tokenUrl = "https://accounts.spotify.com/api/token";
const tokensKey = "tape-journal.spotify-tokens";
const pendingSignInKey = "tape-journal.spotify-sign-in";

export type SpotifyAuthErrorCode =
  | "SIGNED_OUT"
  | "SIGN_IN_DENIED"
  | "SIGN_IN_STATE_MISMATCH"
  | "SESSION_EXPIRED"
  | "TOKEN_REQUEST_FAILED";

export class SpotifyAuthError extends Error {
  readonly code: SpotifyAuthErrorCode;

  constructor(code: SpotifyAuthErrorCode) {
    super(`Spotify sign-in failed (${code}).`);
    this.name = "SpotifyAuthError";
    this.code = code;
  }
}

export interface KeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

interface StoredTokens {
  readonly accessToken: string;
  readonly refreshToken: string;
  readonly expiresAtMs: number;
  /** Space-separated scopes Spotify granted. */
  readonly scope: string;
}

function base64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function randomToken(byteCount: number): string {
  return base64Url(crypto.getRandomValues(new Uint8Array(byteCount)));
}

async function codeChallenge(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(verifier),
  );
  return base64Url(new Uint8Array(digest));
}

function readJson(storage: KeyValueStorage, key: string): unknown {
  const raw = storage.getItem(key);
  if (raw === null) {
    return null;
  }
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}

function readTokens(storage: KeyValueStorage): StoredTokens | null {
  const value = readJson(storage, tokensKey) as Partial<StoredTokens> | null;
  if (
    !value ||
    typeof value.accessToken !== "string" ||
    typeof value.refreshToken !== "string" ||
    typeof value.expiresAtMs !== "number" ||
    typeof value.scope !== "string"
  ) {
    return null;
  }
  // Tokens from before a scope was added count as signed out, so the app asks
  // for consent again rather than failing later.
  const granted = new Set(value.scope.split(" "));
  if (!spotifyScopes.every((scope) => granted.has(scope))) {
    return null;
  }
  return value as StoredTokens;
}

/** Builds the Spotify consent URL and remembers the PKCE verifier and state for the callback. */
export async function createSignInUrl(options: {
  clientId: string;
  redirectUri: string;
  pendingStorage: KeyValueStorage;
}): Promise<string> {
  // 64 random bytes give an 86-character verifier (PKCE allows 43–128).
  const verifier = randomToken(64);
  const state = randomToken(16);
  options.pendingStorage.setItem(
    pendingSignInKey,
    JSON.stringify({ verifier, state }),
  );
  const url = new URL(authorizeUrl);
  url.search = new URLSearchParams({
    response_type: "code",
    client_id: options.clientId,
    scope: spotifyScopes.join(" "),
    redirect_uri: options.redirectUri,
    state,
    code_challenge_method: "S256",
    code_challenge: await codeChallenge(verifier),
  }).toString();
  return url.href;
}

async function requestTokens(
  fetcher: typeof fetch,
  parameters: Record<string, string>,
  nowMs: number,
  previous: Pick<StoredTokens, "refreshToken" | "scope"> | null,
): Promise<StoredTokens> {
  let response: Response;
  try {
    response = await fetcher(tokenUrl, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(parameters).toString(),
    });
  } catch {
    throw new SpotifyAuthError("TOKEN_REQUEST_FAILED");
  }
  if (response.status === 400 || response.status === 401) {
    // invalid_grant and friends: the refresh token or code is no longer usable.
    throw new SpotifyAuthError("SESSION_EXPIRED");
  }
  if (!response.ok) {
    throw new SpotifyAuthError("TOKEN_REQUEST_FAILED");
  }
  const body = (await response.json().catch(() => null)) as {
    access_token?: unknown;
    refresh_token?: unknown;
    expires_in?: unknown;
    scope?: unknown;
  } | null;
  const refreshToken =
    typeof body?.refresh_token === "string"
      ? body.refresh_token
      : (previous?.refreshToken ?? null);
  const scope =
    typeof body?.scope === "string" ? body.scope : (previous?.scope ?? "");
  if (
    typeof body?.access_token !== "string" ||
    typeof body.expires_in !== "number" ||
    refreshToken === null
  ) {
    throw new SpotifyAuthError("TOKEN_REQUEST_FAILED");
  }
  return {
    accessToken: body.access_token,
    refreshToken,
    expiresAtMs: nowMs + body.expires_in * 1_000,
    scope,
  };
}

/**
 * Finishes sign-in when `callbackUrl` is Spotify's redirect back to the app.
 * Returns false when the URL is not a sign-in callback.
 */
export async function completeSignIn(options: {
  clientId: string;
  redirectUri: string;
  callbackUrl: URL;
  pendingStorage: KeyValueStorage;
  tokenStorage: KeyValueStorage;
  fetcher?: typeof fetch;
  nowMs?: () => number;
}): Promise<boolean> {
  const params = options.callbackUrl.searchParams;
  const code = params.get("code");
  const error = params.get("error");
  if (code === null && error === null) {
    return false;
  }
  const pending = readJson(options.pendingStorage, pendingSignInKey) as {
    verifier?: unknown;
    state?: unknown;
  } | null;
  options.pendingStorage.removeItem(pendingSignInKey);
  if (error !== null || code === null) {
    throw new SpotifyAuthError("SIGN_IN_DENIED");
  }
  if (
    !pending ||
    typeof pending.verifier !== "string" ||
    pending.state !== params.get("state")
  ) {
    throw new SpotifyAuthError("SIGN_IN_STATE_MISMATCH");
  }
  const nowMs = options.nowMs ?? Date.now;
  const tokens = await requestTokens(
    options.fetcher ?? fetch,
    {
      grant_type: "authorization_code",
      code,
      redirect_uri: options.redirectUri,
      client_id: options.clientId,
      code_verifier: pending.verifier,
    },
    nowMs(),
    null,
  );
  options.tokenStorage.setItem(tokensKey, JSON.stringify(tokens));
  return true;
}

export interface SpotifyTokenSource {
  isSignedIn(): boolean;
  /** A valid access token, refreshed when close to expiry. */
  getAccessToken(): Promise<string>;
  signOut(): void;
}

export function createSpotifyTokenSource(options: {
  clientId: string;
  tokenStorage: KeyValueStorage;
  fetcher?: typeof fetch;
  nowMs?: () => number;
}): SpotifyTokenSource {
  const fetcher = options.fetcher ?? fetch;
  const nowMs = options.nowMs ?? Date.now;
  let refreshing: Promise<string> | null = null;

  async function refresh(tokens: StoredTokens): Promise<string> {
    try {
      const next = await requestTokens(
        fetcher,
        {
          grant_type: "refresh_token",
          refresh_token: tokens.refreshToken,
          client_id: options.clientId,
        },
        nowMs(),
        tokens,
      );
      options.tokenStorage.setItem(tokensKey, JSON.stringify(next));
      return next.accessToken;
    } catch (error) {
      if (
        error instanceof SpotifyAuthError &&
        error.code === "SESSION_EXPIRED"
      ) {
        options.tokenStorage.removeItem(tokensKey);
      }
      throw error;
    }
  }

  return {
    isSignedIn() {
      return readTokens(options.tokenStorage) !== null;
    },
    async getAccessToken() {
      const tokens = readTokens(options.tokenStorage);
      if (!tokens) {
        throw new SpotifyAuthError("SIGNED_OUT");
      }
      const marginMs = SPOTIFY_AUTH_POLICY.tokenRefreshMarginSeconds * 1_000;
      if (tokens.expiresAtMs - nowMs() > marginMs) {
        return tokens.accessToken;
      }
      // Spotify may rotate the refresh token, so concurrent callers share one refresh.
      refreshing ??= refresh(tokens).finally(() => {
        refreshing = null;
      });
      return refreshing;
    },
    signOut() {
      options.tokenStorage.removeItem(tokensKey);
    },
  };
}
