ALTER TABLE "app"."analyses" ADD COLUMN "source_audio_retention_until" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "app"."analyses" ADD COLUMN "source_audio_cleanup_key" text;--> statement-breakpoint
ALTER TABLE "app"."analysis_uploads" ADD COLUMN "source_audio_retention_until" timestamp with time zone;