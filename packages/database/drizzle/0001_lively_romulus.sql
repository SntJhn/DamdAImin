CREATE TYPE "app"."analysis_language" AS ENUM('taglish', 'english', 'tagalog');--> statement-breakpoint
CREATE TYPE "app"."analysis_upload_status" AS ENUM('created', 'finalized');--> statement-breakpoint
CREATE TABLE "app"."analysis_uploads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"object_key" text NOT NULL,
	"language" "app"."analysis_language" NOT NULL,
	"contract_version" text NOT NULL,
	"content_type" text NOT NULL,
	"status" "app"."analysis_upload_status" NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"analysis_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "analysis_uploads_object_key_unique" UNIQUE("object_key")
);
--> statement-breakpoint
ALTER TABLE "app"."analyses" ADD COLUMN "stage" text DEFAULT 'queued' NOT NULL;--> statement-breakpoint
ALTER TABLE "app"."analyses" ADD COLUMN "language" "app"."analysis_language" DEFAULT 'taglish' NOT NULL;--> statement-breakpoint
ALTER TABLE "app"."analyses" ADD COLUMN "contract_version" text DEFAULT 'taglish-v1' NOT NULL;--> statement-breakpoint
ALTER TABLE "app"."analyses" ADD COLUMN "source_audio_key" text;--> statement-breakpoint
ALTER TABLE "app"."analyses" ADD COLUMN "source_audio_size" integer;--> statement-breakpoint
ALTER TABLE "app"."analyses" ADD COLUMN "result" jsonb;--> statement-breakpoint
ALTER TABLE "app"."analyses" ADD COLUMN "failure_message" text;--> statement-breakpoint
ALTER TABLE "app"."analyses" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;