import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { getTableConfig } from "drizzle-orm/pg-core";
import { ingestionRuns, ingestionSources, tracks } from "../src/schema.ts";
import { connectDatabase } from "../src/index.ts";

test("all tables enable RLS and track identity is enforced per source", () => {
  for (const table of [ingestionSources, tracks, ingestionRuns]) assert.equal(getTableConfig(table).enableRLS, true);
  const unique = getTableConfig(tracks).indexes.find((index) => index.config.name === "tracks_source_url_unique");
  assert.ok(unique?.config.unique);
  assert.deepEqual(unique.config.columns.map((column) => "name" in column ? column.name : null), ["source_id", "source_url"]);
  assert.equal(tracks.artists.notNull, true);
  assert.equal(tracks.trackTitle.notNull, true);
  assert.equal(getTableConfig(tracks).checks.length, 2);
});
test("initial migration contains only current tables and an idempotent source seed", async () => {
  const journal = JSON.parse(await readFile(new URL("../migrations/meta/_journal.json", import.meta.url), "utf8"));
  const statements: string[] = [];
  for (const entry of journal.entries) {
    statements.push(await readFile(new URL("../migrations/" + entry.tag + ".sql", import.meta.url), "utf8"));
  }
  assert.equal(statements.length, 1);
  const initial = statements[0]!;
  const tableNames = [...initial.matchAll(/CREATE TABLE "([^"]+)"/g)].map((match) => match[1]).sort();
  assert.deepEqual(tableNames, ["ingestion_runs", "ingestion_sources", "tracks"]);
  const snapshot = JSON.parse(await readFile(new URL("../migrations/meta/0000_snapshot.json", import.meta.url), "utf8"));
  assert.deepEqual(Object.keys(snapshot.tables).sort(), tableNames.map((name) => "public." + name));
  assert.doesNotMatch(initial, /DROP\s+(?:TABLE|COLUMN)/i);
  for (const tableName of tableNames) {
    assert.ok(initial.includes(`ALTER TABLE "${tableName}" ENABLE ROW LEVEL SECURITY`));
  }
  assert.match(initial, /INSERT INTO "ingestion_sources"/);
  assert.match(initial, /ON CONFLICT \("key"\) DO NOTHING/);
  assert.match(initial, /best_new_tracks|best\/tracks\/rss/);
});
test("TLS bypass is restricted to explicitly flagged loopback test connections", () => {
  assert.throws(() => connectDatabase("https://example.com"));
  assert.throws(() => connectDatabase("postgresql://user:placeholder@remote.example/test", { localTest: true }));
});

test("initial SQL and snapshot match the schema without leases or persisted run counters", async () => {
  const migration = await readFile(new URL("../migrations/0000_initial.sql", import.meta.url), "utf8");
  const snapshot = JSON.parse(await readFile(new URL("../migrations/meta/0000_snapshot.json", import.meta.url), "utf8"));
  assert.equal(snapshot.prevId, "00000000-0000-0000-0000-000000000000");
  for (const table of [ingestionSources, ingestionRuns, tracks]) {
    const config = getTableConfig(table);
    const expectedColumns = config.columns.map((column) => column.name).sort();
    assert.deepEqual(Object.keys(snapshot.tables["public." + config.name].columns).sort(), expectedColumns);
    const definition = migration.split(`CREATE TABLE "${config.name}" (`)[1]?.split("\n);")[0];
    assert.ok(definition);
    const sqlColumns = [...definition.matchAll(/^\s*"([^"]+)"/gm)].map((match) => match[1]).sort();
    assert.deepEqual(sqlColumns, expectedColumns);
  }
  assert.doesNotMatch(migration, /"(?:lease_token|lease_expires_at|found|inserted|updated|unchanged|rejected)"/);
});
