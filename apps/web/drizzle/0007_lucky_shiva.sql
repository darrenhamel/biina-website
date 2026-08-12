CREATE TYPE "public"."web_search_status" AS ENUM('ok', 'no_results', 'error');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "web_search_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"request_id" uuid,
	"user_id" uuid,
	"organization_id" uuid,
	"conversation_id" uuid,
	"query" varchar(500),
	"provider" varchar(48),
	"mode" varchar(24),
	"result_count" integer,
	"pages_fetched" integer,
	"bytes_fetched" integer,
	"fetch_failures" integer,
	"status" "web_search_status" DEFAULT 'ok' NOT NULL,
	"search_latency_ms" integer,
	"fetch_latency_ms" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "plans" ADD COLUMN "web_search_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "plans" ADD COLUMN "daily_web_searches" integer;--> statement-breakpoint
ALTER TABLE "plans" ADD COLUMN "monthly_web_searches" integer;--> statement-breakpoint
ALTER TABLE "plans" ADD COLUMN "max_sources_per_request" integer;--> statement-breakpoint
ALTER TABLE "plans" ADD COLUMN "freshness_filters_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "web_search_user_idx" ON "web_search_requests" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "web_search_created_idx" ON "web_search_requests" USING btree ("created_at");