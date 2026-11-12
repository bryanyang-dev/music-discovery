ALTER TABLE "ingestion_runs" ADD COLUMN "found" integer;--> statement-breakpoint
ALTER TABLE "ingestion_runs" ADD COLUMN "seen" integer;--> statement-breakpoint
ALTER TABLE "ingestion_runs" ADD COLUMN "inserted" integer;--> statement-breakpoint
ALTER TABLE "ingestion_runs" ADD COLUMN "existing" integer;--> statement-breakpoint
ALTER TABLE "ingestion_runs" ADD COLUMN "updated" integer;--> statement-breakpoint
ALTER TABLE "ingestion_runs" ADD COLUMN "unchanged" integer;--> statement-breakpoint
ALTER TABLE "ingestion_runs" ADD COLUMN "rejected" integer;