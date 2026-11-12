import { sql } from "drizzle-orm";
import { boolean, check, date, index, jsonb, pgTable, primaryKey, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import type { RunIssue, RunStatus, StreamingMatchMethod, StreamingMatchStatus } from "@music-discovery/shared";

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

export const trackStreamingMatches = pgTable("track_streaming_matches", {
  trackId: uuid("track_id").notNull().references(() => tracks.id),
  provider: text("provider").notNull(),
  matchStatus: text("match_status").$type<StreamingMatchStatus>().default("pending").notNull(),
  providerTrackId: text("provider_track_id"),
  providerUrl: text("provider_url"),
  providerTitle: text("provider_title"),
  providerArtists: text("provider_artists").array(),
  uploaderName: text("uploader_name"),
  uploaderUrl: text("uploader_url"),
  matchMethod: text("match_method").$type<StreamingMatchMethod>(),
  matchedAt: timestamp("matched_at", { withTimezone: true }),
  lastAttemptAt: timestamp("last_attempt_at", { withTimezone: true }),
  lastErrorCode: text("last_error_code"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  primaryKey({ columns: [table.trackId, table.provider] }),
  check("streaming_matches_provider_valid", sql`${table.provider} ~ '^[a-z][a-z0-9_]*$'`),
  check("streaming_matches_status_valid", sql`${table.matchStatus} IN ('pending', 'matched', 'not_found', 'ambiguous')`),
  check("streaming_matches_method_valid", sql`${table.matchMethod} IS NULL OR ${table.matchMethod} IN ('review_link', 'search', 'manual')`),
  check("streaming_matches_recording_state_valid", sql`(
    ${table.matchStatus} = 'matched'
    AND ${table.providerTrackId} IS NOT NULL AND length(trim(${table.providerTrackId})) > 0
    AND ${table.providerUrl} IS NOT NULL AND length(trim(${table.providerUrl})) > 0
    AND ${table.matchMethod} IS NOT NULL AND ${table.matchedAt} IS NOT NULL
  ) OR (
    ${table.matchStatus} <> 'matched'
    AND ${table.providerTrackId} IS NULL AND ${table.providerUrl} IS NULL
    AND ${table.providerTitle} IS NULL AND ${table.providerArtists} IS NULL
    AND ${table.uploaderName} IS NULL AND ${table.uploaderUrl} IS NULL
    AND ${table.matchMethod} IS NULL AND ${table.matchedAt} IS NULL
  )`),
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

