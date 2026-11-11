import assert from "node:assert/strict";
import { test } from "node:test";
import { DATABASE_POLICY } from "../src/policy.ts";

const MILLISECONDS_PER_SECOND = 1_000;

test("lock and statement limits expire before the client-side operation deadline", () => {
  assert.ok(DATABASE_POLICY.lockTimeoutMs < DATABASE_POLICY.statementTimeoutMs);
  assert.ok(DATABASE_POLICY.statementTimeoutMs < DATABASE_POLICY.operationTimeoutMs);
  assert.ok(DATABASE_POLICY.connectTimeoutSeconds * MILLISECONDS_PER_SECOND < DATABASE_POLICY.operationTimeoutMs);
});

test("database pool limits remain explicit and valid", () => {
  assert.equal(DATABASE_POLICY.maxConnectionCount, 1);
  assert.equal(DATABASE_POLICY.forceCloseTimeoutSeconds, 0);
});
