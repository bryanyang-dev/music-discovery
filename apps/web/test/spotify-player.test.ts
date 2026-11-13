import assert from "node:assert/strict";
import { test } from "node:test";
import {
  SPOTIFY_START_POLICY,
  SpotifyPlaybackError,
  startTapeOnDevice,
  toPlaybackSnapshot,
} from "../src/spotify/spotify-player.ts";

test("snapshots report the requested URI when Spotify relinked the track", () => {
  assert.deepEqual(
    toPlaybackSnapshot({
      paused: false,
      track_window: {
        current_track: {
          uri: "spotify:track:relinked",
          linked_from: { uri: "spotify:track:requested" },
        },
      },
    }),
    { trackUri: "spotify:track:requested", paused: false },
  );
  assert.deepEqual(
    toPlaybackSnapshot({
      paused: true,
      track_window: {
        current_track: { uri: "spotify:track:a", linked_from: { uri: null } },
      },
    }),
    { trackUri: "spotify:track:a", paused: true },
  );
});

test("no state means nothing is playing here", () => {
  assert.deepEqual(toPlaybackSnapshot(null), { trackUri: null, paused: true });
});

test("starting a tape targets this device with the tape's URIs and offset", async () => {
  const requests: { url: string; init: RequestInit | undefined }[] = [];
  const fetcher = (async (url: string | URL, init?: RequestInit) => {
    requests.push({ url: String(url), init });
    return new Response(null, { status: 204 });
  }) as typeof fetch;
  await startTapeOnDevice({
    accessToken: "token",
    deviceId: "device 1",
    uris: ["spotify:track:a", "spotify:track:b"],
    offset: 1,
    fetcher,
    log: () => {},
  });
  const [request] = requests;
  assert.equal(
    request!.url,
    "https://api.spotify.com/v1/me/player/play?device_id=device+1",
  );
  assert.equal(request!.init?.method, "PUT");
  assert.deepEqual(JSON.parse(String(request!.init?.body)), {
    uris: ["spotify:track:a", "spotify:track:b"],
    offset: { position: 1 },
  });
});

function scriptedFetch(responses: { status: number; body?: unknown }[]) {
  const requests: { url: string; body: unknown }[] = [];
  const fetcher = (async (url: string | URL, init?: RequestInit) => {
    requests.push({ url: String(url), body: JSON.parse(String(init?.body)) });
    const next = responses.shift() ?? { status: 500 };
    return new Response(
      next.body === undefined ? null : JSON.stringify(next.body),
      { status: next.status },
    );
  }) as typeof fetch;
  return { fetcher, requests };
}

const waits: number[] = [];
const start = (fetcher: typeof fetch) =>
  startTapeOnDevice({
    accessToken: "token",
    deviceId: "device",
    uris: ["spotify:track:a"],
    offset: 0,
    fetcher,
    log: () => {},
    sleep: async (milliseconds) => {
      waits.push(milliseconds);
    },
  });

test("a rejected start reports Spotify's status, reason and message", async () => {
  const { fetcher } = scriptedFetch([
    {
      status: 403,
      body: {
        error: {
          status: 403,
          message: "Player command failed",
          reason: "PREMIUM_REQUIRED",
        },
      },
    },
  ]);
  await assert.rejects(
    start(fetcher),
    (error: unknown) =>
      error instanceof SpotifyPlaybackError &&
      error.status === 403 &&
      error.message === "HTTP 403: PREMIUM_REQUIRED – Player command failed",
  );
});

test("each Spotify request is logged with its HTTP status", async () => {
  const lines: string[] = [];
  const { fetcher } = scriptedFetch([
    { status: 404 },
    { status: 204 },
    { status: 204 },
  ]);
  await startTapeOnDevice({
    accessToken: "token",
    deviceId: "device",
    uris: ["spotify:track:a"],
    offset: 0,
    fetcher,
    log: (line) => lines.push(line),
    sleep: async () => {},
  });
  assert.deepEqual(lines, [
    "Spotify PUT /v1/me/player/play → HTTP 404",
    "Spotify PUT /v1/me/player → HTTP 204",
    "Spotify PUT /v1/me/player/play → HTTP 204",
  ]);
});

test("a device Spotify does not know yet gets playback transferred, then retried once", async () => {
  const { fetcher, requests } = scriptedFetch([
    {
      status: 404,
      body: { error: { status: 404, message: "Device not found" } },
    },
    { status: 204 },
    { status: 204 },
  ]);
  await start(fetcher);
  assert.deepEqual(
    requests.map((request) => request.url),
    [
      "https://api.spotify.com/v1/me/player/play?device_id=device",
      "https://api.spotify.com/v1/me/player",
      "https://api.spotify.com/v1/me/player/play?device_id=device",
    ],
  );
  assert.deepEqual(requests[1]!.body, { device_ids: ["device"], play: false });
});

test("transfer waits longer between attempts while the device is unknown", async () => {
  waits.length = 0;
  const notFound = {
    status: 404,
    body: { error: { message: "Device not found" } },
  };
  const { fetcher, requests } = scriptedFetch([
    notFound,
    notFound,
    notFound,
    { status: 204 },
    { status: 204 },
  ]);
  await start(fetcher);
  assert.deepEqual(waits, [1_000, 2_000, 3_000]);
  assert.deepEqual(
    requests.map((request) => new URL(request.url).pathname),
    [
      "/v1/me/player/play",
      "/v1/me/player",
      "/v1/me/player",
      "/v1/me/player",
      "/v1/me/player/play",
    ],
  );
});

test("a device still unknown after every transfer attempt is reported", async () => {
  waits.length = 0;
  const notFound = {
    status: 404,
    body: { error: { message: "Device not found" } },
  };
  const { fetcher, requests } = scriptedFetch(
    Array.from(
      { length: 1 + SPOTIFY_START_POLICY.maxTransferAttempts },
      () => notFound,
    ),
  );
  await assert.rejects(start(fetcher), /HTTP 404: Device not found/);
  assert.equal(requests.length, 1 + SPOTIFY_START_POLICY.maxTransferAttempts);
  assert.equal(
    waits.reduce((total, milliseconds) => total + milliseconds, 0),
    15_000,
  );
});

test("a transfer failure other than 404 stops immediately", async () => {
  const { fetcher, requests } = scriptedFetch([
    { status: 404 },
    {
      status: 403,
      body: { error: { message: "Restricted", reason: "PREMIUM_REQUIRED" } },
    },
  ]);
  await assert.rejects(
    start(fetcher),
    /HTTP 403: PREMIUM_REQUIRED – Restricted/,
  );
  assert.equal(requests.length, 2);
});
