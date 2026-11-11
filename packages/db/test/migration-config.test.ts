import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import postgres from "postgres";
import generationConfig from "../../../drizzle.config.ts";

function loadMigrationConfig(connectionString?: string, local = false) {
  const env = { ...process.env };
  delete env.DATABASE_MIGRATION_URL;
  delete env.DATABASE_MIGRATION_ALLOW_LOCAL_NO_TLS;
  if (connectionString !== undefined) {
    env.DATABASE_MIGRATION_URL = connectionString;
  }
  if (local) {
    env.DATABASE_MIGRATION_ALLOW_LOCAL_NO_TLS = "1";
  }
  return spawnSync(process.execPath, [
    "--import", "tsx", "--input-type=module", "-e",
    'import config from "./drizzle.migrate.config.ts"; console.log(JSON.stringify(config));',
  ], { cwd: new URL("../../../", import.meta.url), env, encoding: "utf8" });
}

test("generation configuration needs no database credentials", () => {
  assert.equal(generationConfig.dialect, "postgresql");
  assert.equal(generationConfig.out, "./packages/db/migrations");
  assert.ok(!("dbCredentials" in generationConfig));
});

test("migration configuration enforces TLS despite weaker connection URL settings", async () => {
  const result = loadMigrationConfig(
    "postgresql://user:placeholder@db.example/postgres?sslmode=require&ssl=false&connect_timeout=99",
  );
  assert.equal(result.status, 0, result.stderr);
  const config = JSON.parse(result.stdout);
  assert.equal(config.out, generationConfig.out);
  // Postgres is lazy: reading options does not open a database connection.
  const client = postgres(config.dbCredentials.url);
  try {
    assert.equal(client.options.ssl, "verify-full");
    assert.equal(client.options.connect_timeout, 10);
    assert.equal(client.options.prepare, false);
  } finally {
    await client.end();
  }
});

test("local migration configuration disables TLS only for explicit loopback connections", () => {
  const result = loadMigrationConfig(
    "postgresql://user:placeholder@localhost:54322/postgres?sslrootcert=system&sslmode=require", true,
  );
  assert.equal(result.status, 0, result.stderr);
  const url = new URL(JSON.parse(result.stdout).dbCredentials.url);
  assert.equal(url.searchParams.get("sslmode"), "disable");
  assert.equal(url.searchParams.has("sslrootcert"), false);
  const remote = loadMigrationConfig("postgresql://user:private-value@db.example/postgres", true);
  assert.notEqual(remote.status, 0);
  assert.ok(!remote.stderr.includes("private-value"));
});

test("migration configuration rejects absent or invalid credentials without exposing them", () => {
  for (const url of [undefined, "private-value", "https://user:private-value@db.example/postgres"]) {
    const result = loadMigrationConfig(url);
    assert.notEqual(result.status, 0);
    assert.ok(!result.stderr.includes("private-value"));
  }
});
