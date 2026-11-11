import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { INGESTION_TIMING } from "../src/timing.ts";

const MILLISECONDS_PER_SECOND = 1_000;

test("work plus cleanup fits the configured invocation, and the lease outlives it", () => {
  const workAndCleanupMs = INGESTION_TIMING.maxWorkDurationMs + INGESTION_TIMING.cleanupReserveMs;
  const leaseDurationMs = INGESTION_TIMING.sourceLeaseSeconds * MILLISECONDS_PER_SECOND;

  assert.ok(workAndCleanupMs <= INGESTION_TIMING.defaultInvocationTimeoutMs);
  assert.ok(INGESTION_TIMING.minimumWorkDurationMs < INGESTION_TIMING.maxWorkDurationMs);
  assert.ok(leaseDurationMs > INGESTION_TIMING.defaultInvocationTimeoutMs);
});

test("the undeployed Lambda template and local fallback have the same invocation timeout", async () => {
  const templateUrl = new URL("../../../infra/ingestion.template.json", import.meta.url);
  const template = JSON.parse(await readFile(templateUrl, "utf8"));
  const functionTimeoutSeconds = template.Resources.IngestionFunction.Properties.Timeout;

  assert.equal(functionTimeoutSeconds * MILLISECONDS_PER_SECOND, INGESTION_TIMING.defaultInvocationTimeoutMs);
});
