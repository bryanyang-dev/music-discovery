import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { test } from "node:test";
import {
  IngestionError,
  type TapeStore,
} from "../../../packages/shared/src/index.ts";
import {
  createTapeApiHandler,
  TAPE_API_POLICY,
} from "../src/tape-api-server.ts";

async function withServer(
  tapes: TapeStore,
  run: (baseUrl: string, errors: string[]) => Promise<void>,
): Promise<void> {
  const errors: string[] = [];
  const handle = createTapeApiHandler({
    tapes,
    spotifyClientId: "client-id",
    logger: { log() {}, error: (message: string) => errors.push(message) },
  });
  const server: Server = createServer((request, response) => {
    void handle(request, response);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  try {
    await run(`http://127.0.0.1:${port}`, errors);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test("serves weekly tapes read with the policy limit", async () => {
  const limits: number[] = [];
  const store: TapeStore = {
    async listMatchedTracks(limit) {
      limits.push(limit);
      return [
        {
          id: "a",
          trackTitle: "Song",
          artists: ["Artist"],
          sourceUrl: "https://example.com/a",
          recommendedAt: new Date("2026-11-10T00:00:00Z"),
          providerTrackId: "abc",
        },
      ];
    },
  };
  await withServer(store, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/tapes`);
    assert.equal(response.status, 200);
    const body = (await response.json()) as {
      tapes: { weekStart: string; tracks: { spotifyUri: string }[] }[];
    };
    assert.equal(body.tapes[0]!.weekStart, "2026-11-09");
    assert.equal(body.tapes[0]!.tracks[0]!.spotifyUri, "spotify:track:abc");
  });
  assert.deepEqual(limits, [TAPE_API_POLICY.maxTracksRead]);
});

test("serves the public Spotify client ID", async () => {
  const store: TapeStore = { listMatchedTracks: async () => [] };
  await withServer(store, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/spotify-config`);
    assert.deepEqual(await response.json(), { clientId: "client-id" });
  });
});

test("returns only a safe error code when the database fails", async () => {
  const store: TapeStore = {
    async listMatchedTracks() {
      throw new IngestionError("DATABASE_TIMEOUT");
    },
  };
  await withServer(store, async (baseUrl, errors) => {
    const response = await fetch(`${baseUrl}/api/tapes`);
    assert.equal(response.status, 500);
    assert.deepEqual(await response.json(), { code: "DATABASE_TIMEOUT" });
    assert.match(errors[0]!, /DATABASE_TIMEOUT/);
  });
});

test("rejects unknown routes and methods", async () => {
  const store: TapeStore = { listMatchedTracks: async () => [] };
  await withServer(store, async (baseUrl) => {
    assert.equal((await fetch(`${baseUrl}/api/other`)).status, 404);
    assert.equal(
      (await fetch(`${baseUrl}/api/tapes`, { method: "POST" })).status,
      405,
    );
  });
});
