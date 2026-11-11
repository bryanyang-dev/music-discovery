import { sql } from "drizzle-orm";
import { boolean, check, date, index, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import type { RunIssue, RunStatus } from "@music-discovery/shared";

export const ingestionSources = pgTable("ingestion_sources", {
  id: uuid("id").defaultRandom().primaryKey(),
  key: text("key").notNull().unique(),
  name: text("name").default("pitchfork").notNull(),
  category: text("category").default("best_new_track").notNull(),
  feedUrl: text("feed_url").notNull(),
  enabled: boolean("enabled").default(true).notNull(),
  lastAttemptAt: timestamp("last_attempt_at", { withTimezone: true }),
  lastSuccessAt: timestamp("last_success_at", { withTimezone: true }),
  etag: text("etag"),
  lastModified: text("last_modified"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}).enableRLS();

export const tracks = pgTable("tracks", {
  id: uuid("id").defaultRandom().primaryKey(),
  sourceId: uuid("source_id").notNull().references(() => ingestionSources.id),
  sourceUrl: text("source_url").notNull(),
  sourceGuid: text("source_guid"),
  trackTitle: text("track_title").notNull(),
  artists: text("artists").array().notNull(),
  reviewTitle: text("review_title"),
  reviewAuthor: text("review_author"),
  reviewPublishedAt: timestamp("review_published_at", { withTimezone: true }),
  summary: text("summary"),
  imageUrl: text("image_url"),
  genres: text("genres").array().default(sql`'{}'::text[]`).notNull(),
  labels: text("labels").array().default(sql`'{}'::text[]`).notNull(),
  releaseDate: date("release_date"),
  metadataHash: text("metadata_hash").notNull(),
  firstSeenAt: timestamp("first_seen_at", { withTimezone: true }).defaultNow().notNull(),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex("tracks_source_url_unique").on(table.sourceId, table.sourceUrl),
  index("tracks_review_published_at_idx").on(table.reviewPublishedAt.desc()),
  check("tracks_title_nonempty", sql`length(trim(${table.trackTitle})) > 0`),
  check("tracks_artists_nonempty", sql`cardinality(${table.artists}) > 0 AND array_position(${table.artists}, NULL) IS NULL AND array_to_string(${table.artists}, '') <> ''`),
]).enableRLS();

export const ingestionRuns = pgTable("ingestion_runs", {
  id: uuid("id").defaultRandom().primaryKey(),
  sourceId: uuid("source_id").notNull().references(() => ingestionSources.id),
  startedAt: timestamp("started_at", { withTimezone: true }).defaultNow().notNull(),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
  status: text("status").$type<RunStatus>().default("running").notNull(),
  notModified: boolean("not_modified").default(false).notNull(),
  errors: jsonb("errors").$type<RunIssue[]>().default(sql`'[]'::jsonb`).notNull(),
}, (table) => [
  index("ingestion_runs_source_started_idx").on(table.sourceId, table.startedAt.desc()),
  check("ingestion_runs_status_valid", sql`${table.status} IN ('running', 'succeeded', 'partial_failure', 'failed')`),
]).enableRLS();

