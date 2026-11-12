import assert from "node:assert/strict";
import { test } from "node:test";
import { IngestionError } from "@music-discovery/shared";
import { databaseSsl } from "../src/connection.ts";

test("database connections verify TLS by default, even on loopback", () => {
  for (const host of ["localhost", "127.0.0.1", "[::1]", "database.example"]) {
    assert.equal(
      databaseSsl(`postgresql://user:password@${host}:5432/postgres`),
      "verify-full",
    );
  }
});

test("explicit local connections allow no TLS only on loopback", () => {
  for (const host of ["localhost", "127.0.0.1", "[::1]"]) {
    assert.equal(
      databaseSsl(`postgresql://user:password@${host}:54322/postgres`, {
        allowLocalNoTls: true,
      }),
      false,
    );
  }
  for (const host of [
    "database.example",
    "localhost.example",
    "127.0.0.1.example",
  ]) {
    assert.throws(
      () =>
        databaseSsl(`postgresql://user:password@${host}/postgres`, {
          allowLocalNoTls: true,
        }),
      /DATABASE_CONFIG_INVALID/,
    );
  }
});

test("invalid URLs and protocols fail without exposing credentials", () => {
  for (const value of [
    "private-password",
    "https://user:private-password@database.example/",
  ]) {
    for (const allowLocalNoTls of [false, true]) {
      assert.throws(
        () => databaseSsl(value, { allowLocalNoTls }),
        (error) => {
          assert.ok(error instanceof Error);
          assert.ok(error instanceof IngestionError);
          assert.equal(error.code, "DATABASE_CONFIG_INVALID");
          assert.match(error.message, /PostgreSQL connection URL/);
          assert.ok(!error.message.includes("private-password"));
          return true;
        },
      );
    }
  }
});
