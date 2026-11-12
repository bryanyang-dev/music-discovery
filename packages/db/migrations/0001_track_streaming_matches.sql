CREATE TABLE "track_streaming_matches" (
	"track_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"match_status" text DEFAULT 'pending' NOT NULL,
	"provider_track_id" text,
	"provider_url" text,
	"provider_title" text,
	"provider_artists" text[],
	"uploader_name" text,
	"uploader_url" text,
	"match_method" text,
	"matched_at" timestamp with time zone,
	"last_attempt_at" timestamp with time zone,
	"last_error_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "track_streaming_matches_track_id_provider_pk" PRIMARY KEY("track_id","provider"),
	CONSTRAINT "streaming_matches_provider_valid" CHECK ("track_streaming_matches"."provider" ~ '^[a-z][a-z0-9_]*$'),
	CONSTRAINT "streaming_matches_status_valid" CHECK ("track_streaming_matches"."match_status" IN ('pending', 'matched', 'not_found', 'ambiguous')),
	CONSTRAINT "streaming_matches_method_valid" CHECK ("track_streaming_matches"."match_method" IS NULL OR "track_streaming_matches"."match_method" IN ('review_link', 'search', 'manual')),
	CONSTRAINT "streaming_matches_recording_state_valid" CHECK ((
    "track_streaming_matches"."match_status" = 'matched'
    AND "track_streaming_matches"."provider_track_id" IS NOT NULL AND length(trim("track_streaming_matches"."provider_track_id")) > 0
    AND "track_streaming_matches"."provider_url" IS NOT NULL AND length(trim("track_streaming_matches"."provider_url")) > 0
    AND "track_streaming_matches"."match_method" IS NOT NULL AND "track_streaming_matches"."matched_at" IS NOT NULL
  ) OR (
    "track_streaming_matches"."match_status" <> 'matched'
    AND "track_streaming_matches"."provider_track_id" IS NULL AND "track_streaming_matches"."provider_url" IS NULL
    AND "track_streaming_matches"."provider_title" IS NULL AND "track_streaming_matches"."provider_artists" IS NULL
    AND "track_streaming_matches"."uploader_name" IS NULL AND "track_streaming_matches"."uploader_url" IS NULL
    AND "track_streaming_matches"."match_method" IS NULL AND "track_streaming_matches"."matched_at" IS NULL
  ))
);
--> statement-breakpoint
ALTER TABLE "track_streaming_matches" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "track_streaming_matches" ADD CONSTRAINT "track_streaming_matches_track_id_tracks_id_fk" FOREIGN KEY ("track_id") REFERENCES "public"."tracks"("id") ON DELETE no action ON UPDATE no action;