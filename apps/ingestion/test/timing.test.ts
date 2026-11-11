import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { INGESTION_TIMING } from "../src/timing.ts";

const MILLISECONDS_PER_SECOND = 1_000;

test("the future database Lambda leaves cleanup time", async () => {
  const templateUrl = new URL("../../../infra/ingestion.template.json", import.meta.url);
  const template = JSON.parse(await readFile(templateUrl, "utf8"));
  const functionTimeoutSeconds = template.Resources.IngestionFunction.Properties.Timeout;

  const invocationTimeoutMs = functionTimeoutSeconds * MILLISECONDS_PER_SECOND;
  assert.ok(INGESTION_TIMING.maxWorkDurationMs > 0);
  assert.ok(INGESTION_TIMING.maxWorkDurationMs < invocationTimeoutMs);
});
