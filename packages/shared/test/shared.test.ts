import assert from "node:assert/strict";
import { test } from "node:test";
import { httpUrl, safeLogUrl, IngestionError, errorCode, INGESTION_ERROR_MESSAGES, toIngestionError, type ErrorCode } from "../src/index.ts";

test("logging removes query strings; errors never expose raw messages", () => {
  assert.equal(safeLogUrl("https://example.org/reviews/x/?token=secret"), "https://example.org/reviews/x/");
  assert.equal(safeLogUrl("https://example.org/reviews/song?token=secret#top"), "https://example.org/reviews/song");
  assert.equal(safeLogUrl("https://user:secret@evil.example"), null);
  assert.equal(safeLogUrl("file:///private/secret"), null);
  assert.equal(errorCode(new Error("password")), "DATABASE_ERROR");
  assert.equal(errorCode(new IngestionError("INVALID_FEED")), "INVALID_FEED");
});
test("HTTP helper rejects credentials", () => {
  assert.throws(() => httpUrl("https://user:secret@example.com"));
});



test("every ingestion error has a descriptive message while preserving its code and retry policy", () => {
  for (const code of Object.keys(INGESTION_ERROR_MESSAGES) as ErrorCode[]) {
    const error = new IngestionError(code, 1_000);
    assert.equal(error.code, code);
    assert.equal(error.message, `${code}: ${INGESTION_ERROR_MESSAGES[code]}`);
    assert.notEqual(error.message, code);
    assert.equal(error.retryAfterMs, 1_000);
    assert.equal(toIngestionError(error), error);
  }
});

test("unknown errors never expose their original messages, causes or credentials", () => {
  const error = toIngestionError(new Error("postgres://user:private-password@database/", {
    cause: new Error("private SQL parameters"),
  }));
  assert.equal(error.code, "DATABASE_ERROR");
  assert.ok(!error.stack?.includes("private"));
  assert.ok(!JSON.stringify(error).includes("private"));
  assert.equal(error.cause, undefined);
});
