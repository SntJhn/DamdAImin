CREATE SCHEMA "app";
--> statement-breakpoint
CREATE TYPE "app"."analysis_status" AS ENUM('queued', 'processing', 'completed', 'failed', 'canceled');--> statement-breakpoint
CREATE TABLE "app"."analyses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"status" "app"."analysis_status" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
