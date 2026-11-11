import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { getTableConfig } from "drizzle-orm/pg-core";
import { articles, feeds, ingestionRuns, ingestionSources, tracks } from "../src/schema.ts";
import { connectDatabase } from "../src/index.ts";

test("all new tables enable RLS and track identity is enforced per source", () => {
  for (const table of [ingestionSources, tracks, ingestionRuns]) assert.equal(getTableConfig(table).enableRLS, true);
  const unique = getTableConfig(tracks).indexes.find((index) => index.config.name === "tracks_source_url_unique");
  assert.ok(unique?.config.unique);
  assert.deepEqual(unique.config.columns.map((column) => "name" in column ? column.name : null), ["source_id", "source_url"]);
  assert.equal(tracks.artists.notNull, true);
  assert.equal(tracks.trackTitle.notNull, true);
  assert.equal(getTableConfig(tracks).checks.length, 2);
});
test("legacy tables remain represented and migrations are additive with an idempotent source seed", async () => {
  assert.equal(getTableConfig(feeds).name, "feeds");
  assert.equal(getTableConfig(articles).name, "articles");
  const journal = JSON.parse(await readFile(new URL("../migrations/meta/_journal.json", import.meta.url), "utf8"));
  const statements: string[] = [];
  for (const entry of journal.entries) {
    statements.push(await readFile(new URL("../migrations/" + entry.tag + ".sql", import.meta.url), "utf8"));
  }
  assert.equal(statements.length, 2);
  assert.ok(!statements.some((statement) => /DROP\s+(?:TABLE|COLUMN)/i.test(statement)));
  assert.match(statements[1]!, /INSERT INTO "ingestion_sources"/);
  assert.match(statements[1]!, /ON CONFLICT \("key"\) DO NOTHING/);
  assert.match(statements[1]!, /best_new_tracks|best\/tracks\/rss/);
});
test("TLS bypass is restricted to explicitly flagged loopback test connections", () => {
  assert.throws(() => connectDatabase("https://example.com"));
  assert.throws(() => connectDatabase("postgresql://user:placeholder@remote.example/test", { localTest: true }));
});

