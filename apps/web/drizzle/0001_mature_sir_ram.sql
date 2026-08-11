CREATE TYPE "public"."ai_health_status" AS ENUM('unknown', 'ok', 'degraded', 'error');--> statement-breakpoint
CREATE TYPE "public"."ai_provider_type" AS ENUM('mock', 'ollama', 'openai-compatible');--> statement-breakpoint
CREATE TYPE "public"."ai_route_scope" AS ENUM('persona', 'workload', 'plan');--> statement-breakpoint
CREATE TYPE "public"."user_plan" AS ENUM('FREE', 'PRO', 'BUSINESS', 'ENTERPRISE', 'ADMIN');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ai_audit_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"admin_user_id" uuid,
	"action" varchar(64) NOT NULL,
	"target_type" varchar(32) NOT NULL,
	"target_id" varchar(96),
	"previous_value" jsonb,
	"new_value" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ai_models" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" varchar(64) NOT NULL,
	"display_name" varchar(120) NOT NULL,
	"description" varchar(280),
	"provider_id" uuid NOT NULL,
	"provider_model_id" varchar(160) NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"visible_to_users" boolean DEFAULT false NOT NULL,
	"admin_only" boolean DEFAULT false NOT NULL,
	"maintenance_mode" boolean DEFAULT false NOT NULL,
	"maintenance_note" varchar(280),
	"capabilities" jsonb DEFAULT '{"chat":true,"streaming":true}'::jsonb NOT NULL,
	"context_window" integer,
	"max_output_tokens" integer,
	"priority" integer DEFAULT 100 NOT NULL,
	"estimated_input_cost" real,
	"estimated_output_cost" real,
	"infra_cost_class" varchar(24),
	"avg_latency_ms" integer,
	"avg_ttft_ms" integer,
	"recent_error_rate" real,
	"data_residency" varchar(32),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_models_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ai_providers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" varchar(64) NOT NULL,
	"display_name" varchar(120) NOT NULL,
	"type" "ai_provider_type" NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"maintenance_mode" boolean DEFAULT false NOT NULL,
	"maintenance_note" varchar(280),
	"health_state" "ai_health_status" DEFAULT 'unknown' NOT NULL,
	"health_detail" varchar(280),
	"health_checked_at" timestamp with time zone,
	"priority" integer DEFAULT 100 NOT NULL,
	"base_url_env_ref" varchar(96),
	"api_key_env_ref" varchar(96),
	"region" varchar(32),
	"supports_streaming" boolean DEFAULT true NOT NULL,
	"supports_chat" boolean DEFAULT true NOT NULL,
	"supports_tools" boolean DEFAULT false NOT NULL,
	"supports_vision" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_providers_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ai_routes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"scope" "ai_route_scope" NOT NULL,
	"scope_key" varchar(48) NOT NULL,
	"model_id" uuid NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_routes_scope_key_uniq" UNIQUE("scope","scope_key")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ai_settings" (
	"id" varchar(16) PRIMARY KEY DEFAULT 'singleton' NOT NULL,
	"default_model_id" uuid,
	"fallback_enabled" boolean DEFAULT false NOT NULL,
	"fallback_model_id" uuid,
	"maintenance_mode" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "plan" "user_plan" DEFAULT 'FREE' NOT NULL;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "ai_audit_log" ADD CONSTRAINT "ai_audit_log_admin_user_id_users_id_fk" FOREIGN KEY ("admin_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "ai_models" ADD CONSTRAINT "ai_models_provider_id_ai_providers_id_fk" FOREIGN KEY ("provider_id") REFERENCES "public"."ai_providers"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "ai_routes" ADD CONSTRAINT "ai_routes_model_id_ai_models_id_fk" FOREIGN KEY ("model_id") REFERENCES "public"."ai_models"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "ai_settings" ADD CONSTRAINT "ai_settings_default_model_id_ai_models_id_fk" FOREIGN KEY ("default_model_id") REFERENCES "public"."ai_models"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "ai_settings" ADD CONSTRAINT "ai_settings_fallback_model_id_ai_models_id_fk" FOREIGN KEY ("fallback_model_id") REFERENCES "public"."ai_models"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ai_audit_created_idx" ON "ai_audit_log" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ai_models_provider_idx" ON "ai_models" USING btree ("provider_id");