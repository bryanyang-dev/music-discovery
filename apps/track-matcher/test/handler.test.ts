import assert from "node:assert/strict";
import { test } from "node:test";
import type { Context } from "aws-lambda";
import { createHandler } from "../src/handler.ts";
import { MATCHER_TIMING } from "../src/timing.ts";
import { DATABASE_POLICY } from "../../../packages/db/src/index.ts";
import {
  IngestionError,
  type SpotifyMatch,
  type TrackMatchingStore,
} from "../../../packages/shared/src/index.ts";

const track = {
  id: "00000000-0000-4000-8000-000000000001",
  trackTitle: "A Song",
  artists: ["An Artist"],
};
const quiet = { log() {}, error() {} };
function fixture() {
  const saved: SpotifyMatch[] = [];
  const failures: string[] = [];
  let closed = 0;
  const store: TrackMatchingStore = {
    async listTrackIdsToMatch() {
      return [track.id];
    },
    async getTrack() {
      return track;
    },
    async saveMatch(_track, match) {
      saved.push(match);
      return match;
    },
    async recordFailure(_track, code) {
      failures.push(code);
    },
  };
  const dependencies = {
    databaseUrl: "unused",
    logger: quiet,
    connect: () => ({
      matching: store,
      async close() {
        closed++;
      },
    }),
    lookup: async (): Promise<SpotifyMatch> => ({ status: "not_found" }),
  };
  return {
    store,
    saved,
    failures,
    dependencies,
    get closed() {
      return closed;
    },
  };
}

test("invalid invocation metadata is rejected before connecting", async () => {
  for (const event of [
    undefined,
    null,
    [],
    {},
    { trackId: "bad" },
    { trackId: 123 },
  ]) {
    const handler = createHandler({
      logger: quiet,
      connect() {
        assert.fail("must not connect");
      },
    });
    await assert.rejects(
      // @ts-expect-error Deliberately invoke with malformed JSON to test runtime validation.
      handler(event),
      /INVALID_TRACK_ID/,
    );
  }
});

test("handler loads and persists one track, returns provider result and closes", async () => {
  const state = fixture();
  const result = await createHandler(state.dependencies)({ trackId: track.id });
  assert.deepEqual(result, {
    trackId: track.id,
    provider: "spotify",
    status: "not_found",
  });
  assert.deepEqual(state.saved, [{ status: "not_found" }]);
  assert.equal(state.closed, 1);
});

test("missing track and exhausted budget skip Spotify and persistence", async () => {
  const state = fixture();
  state.store.getTrack = async () => null;
  await assert.rejects(
    createHandler(state.dependencies)({ trackId: track.id }),
    /TRACK_NOT_FOUND/,
  );
  assert.equal(state.saved.length, 0);
  const context = {
    getRemainingTimeInMillis: () => MATCHER_TIMING.cleanupReserveMs,
  } as Context;
  await assert.rejects(
    createHandler({
      logger: quiet,
      connect() {
        assert.fail("must not connect");
      },
    })({ trackId: track.id }, context),
    /RUN_DEADLINE/,
  );
  assert.ok(
    MATCHER_TIMING.cleanupReserveMs >=
      DATABASE_POLICY.operationTimeoutMs +
        DATABASE_POLICY.closeTimeoutSeconds * 1_000,
  );
});

test("provider failure records safe diagnostics without saving an unresolved match", async () => {
  const state = fixture();
  state.dependencies.lookup = async () => {
    throw new IngestionError("SPOTIFY_RATE_LIMITED");
  };
  await assert.rejects(
    createHandler(state.dependencies)({ trackId: track.id }),
    /SPOTIFY_RATE_LIMITED/,
  );
  assert.deepEqual(state.failures, ["SPOTIFY_RATE_LIMITED"]);
  assert.equal(state.saved.length, 0);
  assert.equal(state.closed, 1);
});

test("diagnostic and close failures preserve the original failure", async () => {
  const state = fixture();
  state.store.recordFailure = async () => {
    throw new Error("synthetic-secret-marker");
  };
  const failure = new IngestionError("SPOTIFY_REQUEST_FAILED");
  const handler = createHandler({
    ...state.dependencies,
    lookup: async () => {
      throw failure;
    },
    connect: () => ({
      matching: state.store,
      async close() {
        throw new Error("synthetic-secret-marker");
      },
    }),
  });
  await assert.rejects(handler({ trackId: track.id }), (error) => {
    assert.equal(error, failure);
    assert.deepEqual(failure.cleanupErrors, [
      "DATABASE_ERROR",
      "DATABASE_ERROR",
    ]);
    assert.ok(!String(error).includes("synthetic-secret-marker"));
    return true;
  });
});

test("failure to persist a result fails invocation and still closes", async () => {
  const state = fixture();
  state.store.saveMatch = async () => {
    throw new IngestionError("TRACK_CHANGED");
  };
  await assert.rejects(
    createHandler(state.dependencies)({ trackId: track.id }),
    /TRACK_CHANGED/,
  );
  assert.equal(state.closed, 1);
});

test("default Spotify lookup uses the invocation logger and request ID for every call", async (t) => {
  const state = fixture();
  const messages: Record<string, unknown>[] = [];
  const environment = { ...process.env };
  t.after(() => {
    for (const key of [
      "SPOTIFY_CLIENT_ID",
      "SPOTIFY_CLIENT_SECRET",
      "SPOTIFY_MARKET",
    ]) {
      if (environment[key] === undefined) delete process.env[key];
      else process.env[key] = environment[key];
    }
  });
  process.env.SPOTIFY_CLIENT_ID = "synthetic-client";
  process.env.SPOTIFY_CLIENT_SECRET = "synthetic-secret-marker";
  process.env.SPOTIFY_MARKET = "US";
  const responses = [
    Response.json({ access_token: "synthetic-access-token" }),
    Response.json({ tracks: { items: [], next: null } }),
  ];
  t.mock.method(globalThis, "fetch", async () => {
    const response = responses.shift();
    assert.ok(response);
    return response;
  });
  const { lookup: _lookup, ...dependencies } = state.dependencies;
  await createHandler({
    ...dependencies,
    logger: {
      log(message: string) {
        messages.push(JSON.parse(message));
      },
      error() {
        assert.fail("unexpected failure");
      },
    },
  })({ trackId: track.id }, {
    awsRequestId: "invocation-id",
    getRemainingTimeInMillis: () => 90_000,
  } as Context);
  const calls = messages.filter((entry) =>
    String(entry.event).startsWith("spotify_"),
  );
  assert.equal(calls.length, 4);
  assert.ok(
    calls.every(
      (entry) =>
        entry.requestId === "invocation-id" && entry.trackId === track.id,
    ),
  );
});
