import assert from "node:assert/strict";
import { test } from "node:test";
import { emptyCounts, IngestionError, type IngestionStore, type RunResult } from "@music-discovery/shared";
import { createHandler } from "../src/handler.ts";

const success: RunResult = {
  ...emptyCounts(), runId: "run", status: "succeeded", errors: [], notModified: false,
};
test("Lambda entry point reuses the service, budgets time, closes DB and logs one summary", async () => {
  let closed = false;
  const logs: string[] = [];
  const handler = createHandler({
    databaseUrl: () => "test-only-placeholder",
    connect: () => ({ store: {} as IngestionStore, async close() { closed = true; } }),
    run: async (_store, options) => { assert.ok(options?.signal); return success; },
    log: (message) => logs.push(message),
  });
  assert.deepEqual(await handler({ attacker: "ignored" }, { getRemainingTimeInMillis: () => 300_000 }), success);
  assert.equal(closed, true);
  assert.equal(logs.length, 1);
  assert.equal(JSON.parse(logs[0]!).event, "ingestion_completed");
});
test("partial results throw for Lambda asynchronous retries after logging once", async () => {
  let closed = false;
  const logs: string[] = [];
  const handler = createHandler({
    databaseUrl: () => "placeholder",
    connect: () => ({ store: {} as IngestionStore, async close() { closed = true; } }),
    run: async () => ({ ...success, status: "partial_failure", rejected: 1,
      errors: [{ code: "MISSING_METADATA", sourceUrl: null }] }),
    log: (message) => logs.push(message),
  });
  await assert.rejects(handler(), /MISSING_METADATA/);
  assert.equal(closed, true);
  assert.equal(logs.length, 1);
  assert.equal(JSON.parse(logs[0]!).status, "partial_failure");
});
test("connection failures and missing configuration are sanitized", async () => {
  for (const configured of [false, true]) {
    const logs: string[] = [];
    const handler = createHandler({
      databaseUrl: () => configured ? "postgres://secret" : undefined,
      connect: () => { throw new Error("postgres://secret"); },
      log: (message) => logs.push(message),
    });
    await assert.rejects(handler(), (error) => error instanceof Error && error.message === "DATABASE_ERROR");
    assert.equal(logs.length, 1);
    assert.ok(!logs[0]!.includes("secret"));
  }
});
test("an invocation too near its deadline fails before connecting", async () => {
  const handler = createHandler({
    databaseUrl: () => "placeholder",
    connect: () => { throw new Error("must not connect"); },
    log: () => {},
  });
  await assert.rejects(handler({}, { getRemainingTimeInMillis: () => 20_000 }), /RUN_DEADLINE/);
});
test("cleanup failure logs one failed summary, never a misleading success", async () => {
  const logs: string[] = [];
  const handler = createHandler({
    databaseUrl: () => "placeholder",
    connect: () => ({ store: {} as IngestionStore, async close() { throw new Error("private detail"); } }),
    run: async () => success,
    log: (message) => logs.push(message),
  });
  await assert.rejects(handler(), /DATABASE_ERROR/);
  assert.equal(logs.length, 1);
  assert.equal(JSON.parse(logs[0]!).status, "failed");
  assert.ok(!logs[0]!.includes("private detail"));
});
test("work budget caps ingestion, reserves cleanup time, and supports local invocation", async (context) => {
  const durations: number[] = [];
  const signal = new AbortController().signal;
  context.mock.method(AbortSignal, "timeout", (duration: number) => {
    durations.push(duration);
    return signal;
  });
  const handler = createHandler({
    databaseUrl: () => "placeholder",
    connect: (_url, options) => {
      assert.equal(options.signal, signal);
      return { store: {} as IngestionStore, async close() {} };
    },
    run: async (_store, options) => {
      assert.equal(options?.signal, signal);
      return success;
    },
    log: () => {},
  });

  await handler();
  for (const remainingMs of [600_000, 300_000, 90_000, 61_000]) {
    await handler({}, { getRemainingTimeInMillis: () => remainingMs });
  }

  assert.deepEqual(durations, [240_000, 240_000, 240_000, 30_000, 1_000]);
});
test("less than one second of usable work time fails before opening a connection", async () => {
  let connected = false;
  const handler = createHandler({
    databaseUrl: () => "placeholder",
    connect: () => {
      connected = true;
      return { store: {} as IngestionStore, async close() {} };
    },
    log: () => {},
  });

  await assert.rejects(handler({}, { getRemainingTimeInMillis: () => 60_999 }), /RUN_DEADLINE/);
  assert.equal(connected, false);
});

test("a cleanup error cannot replace an ingestion exception or expose private details", async () => {
  const logs: string[] = [];
  const primaryFailure = new IngestionError("LEASE_LOST");
  const handler = createHandler({
    databaseUrl: () => "placeholder",
    connect: () => ({
      store: {} as IngestionStore,
      async close() {
        throw new Error("private cleanup detail");
      },
    }),
    run: async () => {
      throw primaryFailure;
    },
    log: (message) => logs.push(message),
  });

  await assert.rejects(handler(), (error) => error === primaryFailure);
  assert.deepEqual(primaryFailure.cleanupErrors, ["DATABASE_ERROR"]);
  assert.equal(logs.length, 1);
  const summary = JSON.parse(logs[0]!);
  assert.equal(summary.errors[0].code, "LEASE_LOST");
  assert.deepEqual(summary.cleanupErrors, ["DATABASE_ERROR"]);
  assert.ok(!logs[0]!.includes("private"));
});

test("cleanup failure preserves the primary code of a returned partial result", async () => {
  const handler = createHandler({
    databaseUrl: () => "placeholder",
    connect: () => ({
      store: {} as IngestionStore,
      async close() {
        throw new Error("cleanup failed");
      },
    }),
    run: async () => ({
      ...success,
      status: "partial_failure",
      rejected: 1,
      errors: [{ code: "MISSING_METADATA", sourceUrl: null }],
    }),
    log: () => {},
  });

  await assert.rejects(handler(), (error) => {
    assert.ok(error instanceof IngestionError);
    assert.equal(error.code, "MISSING_METADATA");
    assert.deepEqual(error.cleanupErrors, ["DATABASE_ERROR"]);
    return true;
  });
});

