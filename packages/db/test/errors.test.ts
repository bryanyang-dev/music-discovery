import assert from "node:assert/strict";
import { test } from "node:test";
import { DrizzleQueryError } from "drizzle-orm/errors";
import { IngestionError, type ErrorCode } from "@music-discovery/shared";
import { databaseError } from "../src/errors.ts";

const cases: [string, ErrorCode][] = [
  ["SELF_SIGNED_CERT_IN_CHAIN", "DATABASE_TLS_ERROR"],
  ["UNABLE_TO_VERIFY_LEAF_SIGNATURE", "DATABASE_TLS_ERROR"],
  ["CERT_HAS_EXPIRED", "DATABASE_TLS_ERROR"],
  ["ERR_TLS_CERT_ALTNAME_INVALID", "DATABASE_TLS_ERROR"],
  ["28P01", "DATABASE_AUTH_ERROR"],
  ["28000", "DATABASE_AUTH_ERROR"],
  ["42501", "DATABASE_PERMISSION_ERROR"],
  ["ENOTFOUND", "DATABASE_DNS_ERROR"],
  ["EAI_AGAIN", "DATABASE_DNS_ERROR"],
  ["ECONNREFUSED", "DATABASE_CONNECTION_ERROR"],
  ["CONNECTION_CLOSED", "DATABASE_CONNECTION_ERROR"],
  ["08006", "DATABASE_CONNECTION_ERROR"],
  ["ETIMEDOUT", "DATABASE_TIMEOUT"],
  ["CONNECT_TIMEOUT", "DATABASE_TIMEOUT"],
  ["57014", "DATABASE_TIMEOUT"],
  ["55P03", "DATABASE_TIMEOUT"],
  ["3D000", "DATABASE_SCHEMA_ERROR"],
  ["42P01", "DATABASE_SCHEMA_ERROR"],
  ["42703", "DATABASE_SCHEMA_ERROR"],
];

test("driver and Drizzle-wrapped database failures produce specific, credential-free messages", () => {
  for (const [driverCode, expectedCode] of cases) {
    const driver = Object.assign(new Error("private credentials"), { code: driverCode });
    const wrapper = new DrizzleQueryError("SELECT private_sql", ["private-password"], driver);
    for (const input of [driver, wrapper]) {
      const error = databaseError(input);
      assert.equal(error.code, expectedCode, driverCode);
      assert.equal(error.message, new IngestionError(expectedCode).message);
      assert.ok(!error.stack?.includes("private"));
      assert.ok(!JSON.stringify(error).includes("private"));
      assert.equal(error.cause, undefined);
    }
  }
});

test("known ingestion failures retain identity, retry information and cleanup errors", () => {
  const failure = new IngestionError("RUN_DEADLINE", 1_000);
  failure.cleanupErrors.push("DATABASE_TIMEOUT");
  assert.equal(databaseError(new Error("wrapper", { cause: failure })), failure);
});

test("unknown, misleading and cyclic errors fall back safely without reading driver text", () => {
  const cyclic = { cause: undefined as unknown };
  cyclic.cause = cyclic;
  for (const input of [null, undefined, "private", { code: "private-password" },
    { code: "constructor" }, { code: "__proto__" },
    new Error("password authentication failed: private"), cyclic]) {
    const error = databaseError(input);
    assert.equal(error.code, "DATABASE_ERROR");
    assert.ok(!error.message.includes("private"));
  }
});
