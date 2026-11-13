import assert from "node:assert/strict";
import { test } from "node:test";
import {
  completeSignIn,
  createSignInUrl,
  createSpotifyTokenSource,
  SPOTIFY_AUTH_POLICY,
  spotifyScopes,
  SpotifyAuthError,
  type KeyValueStorage,
} from "../src/spotify/spotify-auth.ts";

function memoryStorage(): KeyValueStorage & { values: Map<string, string> } {
  const values = new Map<string, string>();
  return {
    values,
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => void values.set(key, value),
    removeItem: (key) => void values.delete(key),
  };
}

interface TokenCall {
  body: URLSearchParams;
}

function tokenEndpoint(responses: { status: number; body?: unknown }[]): {
  fetcher: typeof fetch;
  calls: TokenCall[];
} {
  const calls: TokenCall[] = [];
  const fetcher = (async (url: string | URL, init?: RequestInit) => {
    assert.equal(String(url), "https://accounts.spotify.com/api/token");
    calls.push({ body: new URLSearchParams(String(init?.body)) });
    const next = responses.shift() ?? { status: 500 };
    return new Response(JSON.stringify(next.body ?? {}), {
      status: next.status,
    });
  }) as typeof fetch;
  return { fetcher, calls };
}

const redirectUri = "http://127.0.0.1:5173/";
const allScopes = spotifyScopes.join(" ");

async function signedIn(responses: { status: number; body?: unknown }[]) {
  const pendingStorage = memoryStorage();
  const tokenStorage = memoryStorage();
  const signInUrl = new URL(
    await createSignInUrl({ clientId: "client", redirectUri, pendingStorage }),
  );
  const endpoint = tokenEndpoint(responses);
  const callback = new URL(redirectUri);
  callback.searchParams.set("code", "auth-code");
  callback.searchParams.set("state", signInUrl.searchParams.get("state")!);
  await completeSignIn({
    clientId: "client",
    redirectUri,
    callbackUrl: callback,
    pendingStorage,
    tokenStorage,
    fetcher: endpoint.fetcher,
    nowMs: () => 0,
  });
  return { signInUrl, pendingStorage, tokenStorage, endpoint };
}

test("sign-in URL requests the playback scopes with an S256 challenge", async () => {
  const pendingStorage = memoryStorage();
  const url = new URL(
    await createSignInUrl({ clientId: "client", redirectUri, pendingStorage }),
  );
  assert.equal(
    url.origin + url.pathname,
    "https://accounts.spotify.com/authorize",
  );
  assert.equal(url.searchParams.get("client_id"), "client");
  assert.equal(url.searchParams.get("redirect_uri"), redirectUri);
  assert.equal(url.searchParams.get("code_challenge_method"), "S256");
  assert.match(url.searchParams.get("code_challenge")!, /^[A-Za-z0-9_-]{43}$/);
  assert.deepEqual(url.searchParams.get("scope")!.split(" "), [
    "streaming",
    "user-read-email",
    "user-read-private",
    "user-modify-playback-state",
    "user-read-playback-state",
  ]);
  const pending = JSON.parse([...pendingStorage.values.values()][0]!) as {
    verifier: string;
    state: string;
  };
  assert.equal(pending.state, url.searchParams.get("state"));
  assert.match(pending.verifier, /^[A-Za-z0-9_-]{86}$/);
});

test("the callback exchanges the code with the stored verifier", async () => {
  const { pendingStorage, tokenStorage, endpoint } = await signedIn([
    {
      status: 200,
      body: {
        scope: allScopes,
        access_token: "a1",
        refresh_token: "r1",
        expires_in: 3600,
      },
    },
  ]);
  const body = endpoint.calls[0]!.body;
  assert.equal(body.get("grant_type"), "authorization_code");
  assert.equal(body.get("code"), "auth-code");
  assert.equal(body.get("redirect_uri"), redirectUri);
  assert.match(body.get("code_verifier")!, /^[A-Za-z0-9_-]{86}$/);
  assert.equal(pendingStorage.values.size, 0);
  const tokens = createSpotifyTokenSource({
    clientId: "client",
    tokenStorage,
    nowMs: () => 0,
  });
  assert.equal(tokens.isSignedIn(), true);
  assert.equal(await tokens.getAccessToken(), "a1");
});

test("a callback with a mismatched state or a denial is rejected", async () => {
  const pendingStorage = memoryStorage();
  await createSignInUrl({ clientId: "client", redirectUri, pendingStorage });
  const forged = new URL(`${redirectUri}?code=x&state=forged`);
  await assert.rejects(
    completeSignIn({
      clientId: "client",
      redirectUri,
      callbackUrl: forged,
      pendingStorage,
      tokenStorage: memoryStorage(),
    }),
    (error: unknown) =>
      error instanceof SpotifyAuthError &&
      error.code === "SIGN_IN_STATE_MISMATCH",
  );
  await assert.rejects(
    completeSignIn({
      clientId: "client",
      redirectUri,
      callbackUrl: new URL(`${redirectUri}?error=access_denied`),
      pendingStorage: memoryStorage(),
      tokenStorage: memoryStorage(),
    }),
    (error: unknown) =>
      error instanceof SpotifyAuthError && error.code === "SIGN_IN_DENIED",
  );
});

test("a URL without a code is not a callback", async () => {
  assert.equal(
    await completeSignIn({
      clientId: "client",
      redirectUri,
      callbackUrl: new URL(redirectUri),
      pendingStorage: memoryStorage(),
      tokenStorage: memoryStorage(),
    }),
    false,
  );
});

test("near expiry, concurrent callers share one refresh and keep a rotated token", async () => {
  const { tokenStorage } = await signedIn([
    {
      status: 200,
      body: {
        scope: allScopes,
        access_token: "a1",
        refresh_token: "r1",
        expires_in: 3600,
      },
    },
  ]);
  const refresh = tokenEndpoint([
    {
      status: 200,
      body: { access_token: "a2", refresh_token: "r2", expires_in: 3600 },
    },
  ]);
  const nearExpiryMs =
    3600_000 - SPOTIFY_AUTH_POLICY.tokenRefreshMarginSeconds * 1_000;
  const tokens = createSpotifyTokenSource({
    clientId: "client",
    tokenStorage,
    fetcher: refresh.fetcher,
    nowMs: () => nearExpiryMs,
  });
  const results = await Promise.all([
    tokens.getAccessToken(),
    tokens.getAccessToken(),
  ]);
  assert.deepEqual(results, ["a2", "a2"]);
  assert.equal(refresh.calls.length, 1);
  assert.equal(refresh.calls[0]!.body.get("refresh_token"), "r1");
  assert.match([...tokenStorage.values.values()][0]!, /"refreshToken":"r2"/);
});

test("a refresh without a new refresh token keeps the old one", async () => {
  const { tokenStorage } = await signedIn([
    {
      status: 200,
      body: {
        scope: allScopes,
        access_token: "a1",
        refresh_token: "r1",
        expires_in: 60,
      },
    },
  ]);
  const refresh = tokenEndpoint([
    { status: 200, body: { access_token: "a2", expires_in: 3600 } },
  ]);
  const tokens = createSpotifyTokenSource({
    clientId: "client",
    tokenStorage,
    fetcher: refresh.fetcher,
    nowMs: () => 0,
  });
  assert.equal(await tokens.getAccessToken(), "a2");
  assert.match([...tokenStorage.values.values()][0]!, /"refreshToken":"r1"/);
});

test("a rejected refresh signs out; a failed request does not", async () => {
  const setup = await signedIn([
    {
      status: 200,
      body: {
        scope: allScopes,
        access_token: "a1",
        refresh_token: "r1",
        expires_in: 60,
      },
    },
  ]);
  const unavailable = createSpotifyTokenSource({
    clientId: "client",
    tokenStorage: setup.tokenStorage,
    fetcher: tokenEndpoint([{ status: 503 }]).fetcher,
    nowMs: () => 0,
  });
  await assert.rejects(unavailable.getAccessToken(), /TOKEN_REQUEST_FAILED/);
  assert.equal(unavailable.isSignedIn(), true);

  const revoked = createSpotifyTokenSource({
    clientId: "client",
    tokenStorage: setup.tokenStorage,
    fetcher: tokenEndpoint([{ status: 400, body: { error: "invalid_grant" } }])
      .fetcher,
    nowMs: () => 0,
  });
  await assert.rejects(revoked.getAccessToken(), /SESSION_EXPIRED/);
  assert.equal(revoked.isSignedIn(), false);
  await assert.rejects(revoked.getAccessToken(), /SIGNED_OUT/);
});

test("tokens missing a required scope count as signed out", async () => {
  const { tokenStorage } = await signedIn([
    {
      status: 200,
      body: {
        access_token: "a1",
        refresh_token: "r1",
        expires_in: 3600,
        scope: "streaming user-read-email",
      },
    },
  ]);
  const tokens = createSpotifyTokenSource({
    clientId: "client",
    tokenStorage,
    nowMs: () => 0,
  });
  assert.equal(tokens.isSignedIn(), false);
  await assert.rejects(tokens.getAccessToken(), /SIGNED_OUT/);
});
