CREATE TYPE "public"."ai_cost_class" AS ENUM('VERY_LOW', 'LOW', 'MEDIUM', 'HIGH', 'PREMIUM');--> statement-breakpoint
CREATE TYPE "public"."ai_usage_status" AS ENUM('success', 'error', 'cancelled', 'timeout');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "plan_assignments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"plan_slug" varchar(32) NOT NULL,
	"assigned_by" uuid,
	"note" varchar(200),
	"starts_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ends_at" timestamp with time zone,
	"organization_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "plans" (
	"slug" varchar(32) PRIMARY KEY NOT NULL,
	"display_name" varchar(80) NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"daily_request_limit" integer,
	"monthly_request_limit" integer,
	"daily_token_limit" integer,
	"monthly_token_limit" integer,
	"requests_per_minute" integer,
	"max_concurrent" integer,
	"max_context_tokens" integer,
	"max_output_tokens" integer,
	"allowed_models" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"allowed_workloads" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"allowed_personas" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"files_eligible" boolean DEFAULT false NOT NULL,
	"tools_eligible" boolean DEFAULT false NOT NULL,
	"web_search_eligible" boolean DEFAULT false NOT NULL,
	"priority_class" integer DEFAULT 100 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "usage_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"request_id" uuid NOT NULL,
	"user_id" uuid,
	"organization_id" uuid,
	"conversation_id" uuid,
	"biina_model_slug" varchar(64),
	"provider_type" varchar(48),
	"provider_model_id" varchar(160),
	"persona" varchar(32),
	"workload" varchar(32),
	"plan" varchar(32),
	"input_tokens" integer,
	"output_tokens" integer,
	"total_tokens" integer,
	"estimated_input_cost" real,
	"estimated_output_cost" real,
	"estimated_total_cost" real,
	"currency" varchar(8) DEFAULT 'USD' NOT NULL,
	"ttft_ms" integer,
	"generation_ms" integer,
	"total_latency_ms" integer,
	"fallback_used" boolean DEFAULT false NOT NULL,
	"fallback_provider_type" varchar(48),
	"fallback_model_slug" varchar(64),
	"provider_attempts" jsonb,
	"status" "ai_usage_status" NOT NULL,
	"failure_category" varchar(48),
	"counted_against_quota" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	CONSTRAINT "usage_events_request_id_unique" UNIQUE("request_id")
);
--> statement-breakpoint
ALTER TABLE "ai_models" ADD COLUMN "input_cost_per_million" real;--> statement-breakpoint
ALTER TABLE "ai_models" ADD COLUMN "output_cost_per_million" real;--> statement-breakpoint
ALTER TABLE "ai_models" ADD COLUMN "fixed_request_cost" real;--> statement-breakpoint
ALTER TABLE "ai_models" ADD COLUMN "cost_currency" varchar(8) DEFAULT 'USD' NOT NULL;--> statement-breakpoint
ALTER TABLE "ai_models" ADD COLUMN "cost_class" "ai_cost_class";--> statement-breakpoint
ALTER TABLE "ai_models" ADD COLUMN "cost_source" varchar(64);--> statement-breakpoint
ALTER TABLE "ai_models" ADD COLUMN "cost_updated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "ai_models" ADD COLUMN "monthly_budget" real;--> statement-breakpoint
ALTER TABLE "ai_providers" ADD COLUMN "monthly_budget" real;--> statement-breakpoint
ALTER TABLE "ai_settings" ADD COLUMN "currency" varchar(8) DEFAULT 'USD' NOT NULL;--> statement-breakpoint
ALTER TABLE "ai_settings" ADD COLUMN "daily_cost_warn" real;--> statement-breakpoint
ALTER TABLE "ai_settings" ADD COLUMN "daily_cost_hard_limit" real;--> statement-breakpoint
ALTER TABLE "ai_settings" ADD COLUMN "monthly_cost_warn" real;--> statement-breakpoint
ALTER TABLE "ai_settings" ADD COLUMN "monthly_cost_hard_limit" real;--> statement-breakpoint
ALTER TABLE "ai_settings" ADD COLUMN "hard_limit_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "plan_assignments" ADD CONSTRAINT "plan_assignments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "plan_assignments" ADD CONSTRAINT "plan_assignments_assigned_by_users_id_fk" FOREIGN KEY ("assigned_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "usage_events" ADD CONSTRAINT "usage_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "plan_assignments_user_idx" ON "plan_assignments" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "usage_user_created_idx" ON "usage_events" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "usage_provider_created_idx" ON "usage_events" USING btree ("provider_type","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "usage_model_created_idx" ON "usage_events" USING btree ("biina_model_slug","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "usage_plan_created_idx" ON "usage_events" USING btree ("plan","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "usage_status_idx" ON "usage_events" USING btree ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "usage_created_idx" ON "usage_events" USING btree ("created_at");