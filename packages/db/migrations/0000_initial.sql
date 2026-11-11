CREATE TABLE "feeds" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "url" text NOT NULL,
  "title" text NOT NULL,
  "enabled" boolean DEFAULT true NOT NULL,
  "last_checked_at" timestamp with time zone,
  "last_success_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "feeds_url_unique" UNIQUE("url")
);
--> statement-breakpoint
ALTER TABLE "feeds" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE TABLE "articles" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "feed_id" uuid NOT NULL,
  "source_key" text NOT NULL,
  "guid" text,
  "url" text,
  "title" text NOT NULL,
  "author" text,
  "summary" text,
  "published_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "articles_feed_id_feeds_id_fk" FOREIGN KEY ("feed_id") REFERENCES "feeds"("id") ON DELETE cascade
);
--> statement-breakpoint
ALTER TABLE "articles" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE UNIQUE INDEX "articles_feed_source_unique" ON "articles" ("feed_id", "source_key");
--> statement-breakpoint
CREATE INDEX "articles_published_at_idx" ON "articles" ("published_at");

