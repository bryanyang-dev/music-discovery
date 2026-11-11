import assert from "node:assert/strict";
import { test } from "node:test";
import { boundDatabaseOperation } from "../src/deadline.ts";
import { IngestionError } from "@music-discovery/shared";

test("database timeout tears down the client before rejecting and ignores late results", async () => {
  let terminated = false;
  let complete: ((value: string) => void) | undefined;
  const work = boundDatabaseOperation(
    () => new Promise<string>((resolve) => { complete = resolve; }),
    async () => { terminated = true; }, { timeoutMs: 5 },
  );
  await assert.rejects(work, (error) => error instanceof IngestionError && error.code === "DATABASE_ERROR");
  assert.equal(terminated, true);
  complete?.("late");
});
test("aborting a stalled database operation tears down instead of just racing a promise", async () => {
  const controller = new AbortController();
  let terminated = false;
  const work = boundDatabaseOperation(() => new Promise<void>(() => {}),
    async () => { terminated = true; }, { signal: controller.signal, timeoutMs: 100 });
  controller.abort();
  await assert.rejects(work, /RUN_DEADLINE/);
  assert.equal(terminated, true);
});
test("successful operations and ordinary errors do not destroy a healthy database connection", async () => {
  let terminated = false;
  const terminate = async () => { terminated = true; };
  assert.equal(await boundDatabaseOperation(async () => 42, terminate), 42);
  await assert.rejects(boundDatabaseOperation(async () => { throw new Error("query failure"); }, terminate), /query failure/);
  assert.equal(terminated, false);
});

test("cancellation before the operation microtask never starts database work", async () => {
  const controller = new AbortController();
  let started = false;
  const work = boundDatabaseOperation(async () => {
    started = true;
  }, async () => {}, { signal: controller.signal });
  controller.abort();

  await assert.rejects(work, /RUN_DEADLINE/);
  assert.equal(started, false);
});

test("a stalled termination cannot make the database deadline wait forever", async (context) => {
  context.mock.timers.enable({ apis: ["setTimeout"] });
  const work = boundDatabaseOperation(
    () => new Promise<void>(() => {}),
    () => new Promise<void>(() => {}),
    { timeoutMs: 5 },
  );
  const rejected = assert.rejects(work, /DATABASE_ERROR/);

  context.mock.timers.tick(5);
  context.mock.timers.tick(3_000);
  await rejected;
});

