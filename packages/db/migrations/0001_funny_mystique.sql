CREATE TABLE "ingestion_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_id" uuid NOT NULL,
	"lease_token" uuid NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"status" text DEFAULT 'running' NOT NULL,
	"found" integer DEFAULT 0 NOT NULL,
	"inserted" integer DEFAULT 0 NOT NULL,
	"updated" integer DEFAULT 0 NOT NULL,
	"unchanged" integer DEFAULT 0 NOT NULL,
	"rejected" integer DEFAULT 0 NOT NULL,
	"not_modified" boolean DEFAULT false NOT NULL,
	"errors" jsonb DEFAULT '[]'::jsonb NOT NULL,
	CONSTRAINT "ingestion_runs_status_valid" CHECK ("ingestion_runs"."status" IN ('running', 'succeeded', 'partial_failure', 'failed')),
	CONSTRAINT "ingestion_runs_counts_nonnegative" CHECK ("ingestion_runs"."found" >= 0 AND "ingestion_runs"."inserted" >= 0 AND "ingestion_runs"."updated" >= 0 AND "ingestion_runs"."unchanged" >= 0 AND "ingestion_runs"."rejected" >= 0)
);
--> statement-breakpoint
ALTER TABLE "ingestion_runs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "ingestion_sources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"name" text DEFAULT 'pitchfork' NOT NULL,
	"category" text DEFAULT 'best_new_track' NOT NULL,
	"feed_url" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"last_attempt_at" timestamp with time zone,
	"last_success_at" timestamp with time zone,
	"etag" text,
	"last_modified" text,
	"lease_token" uuid,
	"lease_expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ingestion_sources_key_unique" UNIQUE("key")
);
--> statement-breakpoint
ALTER TABLE "ingestion_sources" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "tracks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_id" uuid NOT NULL,
	"source_url" text NOT NULL,
	"source_guid" text,
	"track_title" text NOT NULL,
	"artists" text[] NOT NULL,
	"review_title" text,
	"review_author" text,
	"review_published_at" timestamp with time zone,
	"summary" text,
	"image_url" text,
	"genres" text[] DEFAULT '{}'::text[] NOT NULL,
	"labels" text[] DEFAULT '{}'::text[] NOT NULL,
	"release_date" date,
	"metadata_hash" text NOT NULL,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tracks_title_nonempty" CHECK (length(trim("tracks"."track_title")) > 0),
	CONSTRAINT "tracks_artists_nonempty" CHECK (cardinality("tracks"."artists") > 0 AND array_position("tracks"."artists", NULL) IS NULL AND array_to_string("tracks"."artists", '') <> '')
);
--> statement-breakpoint
ALTER TABLE "tracks" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "ingestion_runs" ADD CONSTRAINT "ingestion_runs_source_id_ingestion_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."ingestion_sources"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tracks" ADD CONSTRAINT "tracks_source_id_ingestion_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."ingestion_sources"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ingestion_runs_source_started_idx" ON "ingestion_runs" USING btree ("source_id","started_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "tracks_source_url_unique" ON "tracks" USING btree ("source_id","source_url");--> statement-breakpoint
CREATE INDEX "tracks_review_published_at_idx" ON "tracks" USING btree ("review_published_at" DESC NULLS LAST);
--> statement-breakpoint
INSERT INTO "ingestion_sources" ("key", "name", "category", "feed_url")
VALUES ('pitchfork_best_new_tracks', 'pitchfork', 'best_new_track', 'https://pitchfork.com/feed/reviews/best/tracks/rss')
ON CONFLICT ("key") DO NOTHING;
