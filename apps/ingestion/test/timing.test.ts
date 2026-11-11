import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { INGESTION_TIMING } from "../src/timing.ts";

const MILLISECONDS_PER_SECOND = 1_000;

test("database ingestion work is bounded by its source lease", () => {
  const leaseDurationMs = INGESTION_TIMING.sourceLeaseSeconds * MILLISECONDS_PER_SECOND;
  assert.ok(INGESTION_TIMING.maxWorkDurationMs > 0);
  assert.ok(leaseDurationMs > INGESTION_TIMING.maxWorkDurationMs);
});

test("the future database Lambda leaves cleanup time and finishes before its lease expires", async () => {
  const templateUrl = new URL("../../../infra/ingestion.template.json", import.meta.url);
  const template = JSON.parse(await readFile(templateUrl, "utf8"));
  const functionTimeoutSeconds = template.Resources.IngestionFunction.Properties.Timeout;

  const invocationTimeoutMs = functionTimeoutSeconds * MILLISECONDS_PER_SECOND;
  const leaseDurationMs = INGESTION_TIMING.sourceLeaseSeconds * MILLISECONDS_PER_SECOND;
  assert.ok(INGESTION_TIMING.maxWorkDurationMs < invocationTimeoutMs);
  assert.ok(invocationTimeoutMs < leaseDurationMs);
});
