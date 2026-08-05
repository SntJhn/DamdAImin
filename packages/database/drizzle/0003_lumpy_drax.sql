ALTER TABLE "app"."analyses" ADD COLUMN "retain_source_audio" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "app"."analyses" ADD COLUMN "retry_of_analysis_id" uuid;--> statement-breakpoint
ALTER TABLE "app"."analyses" ADD COLUMN "retry_analysis_id" uuid;--> statement-breakpoint
ALTER TABLE "app"."analysis_uploads" ADD COLUMN "retain_source_audio" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "app"."analyses" ADD CONSTRAINT "analyses_retry_of_analysis_id_unique" UNIQUE("retry_of_analysis_id");