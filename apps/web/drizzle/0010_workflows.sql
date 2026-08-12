CREATE TYPE "public"."standing_auth_status" AS ENUM('ACTIVE', 'REVOKED', 'EXPIRED');--> statement-breakpoint
CREATE TYPE "public"."workflow_approval_policy" AS ENUM('ASK_EVERY_WRITE', 'ASK_HIGH_RISK_ONLY', 'READ_ONLY_AUTOMATIC');--> statement-breakpoint
CREATE TYPE "public"."workflow_owner_type" AS ENUM('PERSONAL', 'ORGANIZATION');--> statement-breakpoint
CREATE TYPE "public"."workflow_run_status" AS ENUM('QUEUED', 'RUNNING', 'AWAITING_APPROVAL', 'COMPLETED', 'PARTIALLY_COMPLETED', 'FAILED', 'CANCELED', 'SKIPPED', 'BLOCKED');--> statement-breakpoint
CREATE TYPE "public"."workflow_status" AS ENUM('DRAFT', 'ACTIVE', 'PAUSED', 'DISABLED', 'ARCHIVED', 'AUTO_PAUSED');--> statement-breakpoint
CREATE TYPE "public"."workflow_trigger_type" AS ENUM('MANUAL', 'SCHEDULE', 'CONDITION', 'WEBHOOK', 'CONNECTOR_EVENT');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "agent_definitions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_type" "workflow_owner_type" NOT NULL,
	"user_id" uuid,
	"organization_id" uuid,
	"name" varchar(120) NOT NULL,
	"description" varchar(400),
	"instructions" text DEFAULT '' NOT NULL,
	"allowed_tools" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"allowed_connectors" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"default_model_profile" varchar(64),
	"max_steps" integer DEFAULT 8 NOT NULL,
	"max_tool_calls" integer DEFAULT 16 NOT NULL,
	"approval_policy" "workflow_approval_policy" DEFAULT 'ASK_EVERY_WRITE' NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "standing_authorizations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"organization_id" uuid,
	"workflow_id" uuid,
	"tool_id" varchar(64) NOT NULL,
	"connection_id" uuid NOT NULL,
	"risk_ceiling" varchar(32) NOT NULL,
	"allowed_destinations" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"max_executions" integer,
	"max_executions_per_day" integer,
	"executions_used" integer DEFAULT 0 NOT NULL,
	"status" "standing_auth_status" DEFAULT 'ACTIVE' NOT NULL,
	"approved_by_user_id" uuid,
	"starts_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "workflow_condition_state" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workflow_id" uuid NOT NULL,
	"last_checked_at" timestamp with time zone,
	"last_matched_at" timestamp with time zone,
	"cursor" varchar(200),
	"seen_hashes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workflow_condition_state_workflow_id_unique" UNIQUE("workflow_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "workflow_notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"organization_id" uuid,
	"workflow_id" uuid,
	"workflow_run_id" uuid,
	"channel" varchar(16) DEFAULT 'IN_APP' NOT NULL,
	"kind" varchar(32) NOT NULL,
	"title" varchar(200) NOT NULL,
	"body" varchar(1000),
	"dedupe_key" varchar(160),
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workflow_notifications_dedupe_unique" UNIQUE("user_id","dedupe_key")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "workflow_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workflow_id" uuid NOT NULL,
	"workflow_version" integer DEFAULT 1 NOT NULL,
	"trigger_type" "workflow_trigger_type" NOT NULL,
	"user_id" uuid,
	"organization_id" uuid,
	"status" "workflow_run_status" DEFAULT 'QUEUED' NOT NULL,
	"run_key" varchar(120) NOT NULL,
	"scheduled_for" timestamp with time zone,
	"agent_session_id" uuid,
	"dry_run" boolean DEFAULT false NOT NULL,
	"steps_executed" integer DEFAULT 0 NOT NULL,
	"tool_calls" integer DEFAULT 0 NOT NULL,
	"write_actions" integer DEFAULT 0 NOT NULL,
	"estimated_cost" real DEFAULT 0 NOT NULL,
	"locked_by" varchar(80),
	"locked_at" timestamp with time zone,
	"heartbeat_at" timestamp with time zone,
	"attempt" integer DEFAULT 1 NOT NULL,
	"error_code" varchar(48),
	"error_summary" varchar(400),
	"result_summary" varchar(1000),
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workflow_runs_run_key_unique" UNIQUE("workflow_id","run_key")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "workflow_triggers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workflow_id" uuid NOT NULL,
	"type" "workflow_trigger_type" NOT NULL,
	"schedule" jsonb,
	"timezone" varchar(64) DEFAULT 'UTC' NOT NULL,
	"condition_type" varchar(48),
	"condition_config" jsonb,
	"check_interval_minutes" integer,
	"missed_run_policy" varchar(24) DEFAULT 'RUN_ONCE_WHEN_RECOVERED' NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "workflow_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workflow_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"snapshot" jsonb NOT NULL,
	"config_hash" varchar(96) NOT NULL,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workflow_versions_unique" UNIQUE("workflow_id","version")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "workflows" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_type" "workflow_owner_type" NOT NULL,
	"user_id" uuid,
	"organization_id" uuid,
	"name" varchar(160) NOT NULL,
	"description" varchar(600),
	"goal" text NOT NULL,
	"agent_definition_id" uuid,
	"status" "workflow_status" DEFAULT 'DRAFT' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"trigger_type" "workflow_trigger_type" DEFAULT 'MANUAL' NOT NULL,
	"agent_mode" "agent_mode" DEFAULT 'AGENT' NOT NULL,
	"approval_policy" "workflow_approval_policy" DEFAULT 'ASK_EVERY_WRITE' NOT NULL,
	"timezone" varchar(64) DEFAULT 'UTC' NOT NULL,
	"knowledge_base_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"connection_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"web_search_enabled" boolean DEFAULT false NOT NULL,
	"inputs" jsonb DEFAULT '{}'::jsonb,
	"max_steps" integer DEFAULT 8 NOT NULL,
	"max_tool_calls" integer DEFAULT 16 NOT NULL,
	"max_writes_per_run" integer DEFAULT 1 NOT NULL,
	"max_cost_per_run" real,
	"max_runs_per_day" integer,
	"max_runs_per_month" integer,
	"monthly_cost_budget" real,
	"overlap_policy" varchar(12) DEFAULT 'SKIP' NOT NULL,
	"notify_on_success" varchar(16) DEFAULT 'MEANINGFUL' NOT NULL,
	"notify_on_failure" boolean DEFAULT true NOT NULL,
	"max_consecutive_failures" integer DEFAULT 5 NOT NULL,
	"consecutive_failures" integer DEFAULT 0 NOT NULL,
	"created_by_user_id" uuid,
	"last_run_at" timestamp with time zone,
	"next_run_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "plans" ADD COLUMN "workflows_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "plans" ADD COLUMN "max_active_workflows" integer;--> statement-breakpoint
ALTER TABLE "plans" ADD COLUMN "scheduled_automations_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "plans" ADD COLUMN "condition_automations_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "plans" ADD COLUMN "workflow_runs_per_month" integer;--> statement-breakpoint
ALTER TABLE "plans" ADD COLUMN "max_workflow_steps" integer;--> statement-breakpoint
ALTER TABLE "plans" ADD COLUMN "scheduled_writes_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "agent_definitions" ADD CONSTRAINT "agent_definitions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "agent_definitions" ADD CONSTRAINT "agent_definitions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "agent_definitions" ADD CONSTRAINT "agent_definitions_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "standing_authorizations" ADD CONSTRAINT "standing_authorizations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "standing_authorizations" ADD CONSTRAINT "standing_authorizations_workflow_id_workflows_id_fk" FOREIGN KEY ("workflow_id") REFERENCES "public"."workflows"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "standing_authorizations" ADD CONSTRAINT "standing_authorizations_approved_by_user_id_users_id_fk" FOREIGN KEY ("approved_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "workflow_condition_state" ADD CONSTRAINT "workflow_condition_state_workflow_id_workflows_id_fk" FOREIGN KEY ("workflow_id") REFERENCES "public"."workflows"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "workflow_notifications" ADD CONSTRAINT "workflow_notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "workflow_runs" ADD CONSTRAINT "workflow_runs_workflow_id_workflows_id_fk" FOREIGN KEY ("workflow_id") REFERENCES "public"."workflows"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "workflow_triggers" ADD CONSTRAINT "workflow_triggers_workflow_id_workflows_id_fk" FOREIGN KEY ("workflow_id") REFERENCES "public"."workflows"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "workflow_versions" ADD CONSTRAINT "workflow_versions_workflow_id_workflows_id_fk" FOREIGN KEY ("workflow_id") REFERENCES "public"."workflows"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "workflow_versions" ADD CONSTRAINT "workflow_versions_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "workflows" ADD CONSTRAINT "workflows_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "workflows" ADD CONSTRAINT "workflows_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "workflows" ADD CONSTRAINT "workflows_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_defs_user_idx" ON "agent_definitions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_defs_org_idx" ON "agent_definitions" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "standing_auth_user_idx" ON "standing_authorizations" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "standing_auth_workflow_idx" ON "standing_authorizations" USING btree ("workflow_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "standing_auth_expires_idx" ON "standing_authorizations" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "workflow_condition_workflow_idx" ON "workflow_condition_state" USING btree ("workflow_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "workflow_notifications_user_idx" ON "workflow_notifications" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "workflow_runs_workflow_idx" ON "workflow_runs" USING btree ("workflow_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "workflow_runs_status_idx" ON "workflow_runs" USING btree ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "workflow_runs_created_idx" ON "workflow_runs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "workflow_triggers_workflow_idx" ON "workflow_triggers" USING btree ("workflow_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "workflows_user_idx" ON "workflows" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "workflows_org_idx" ON "workflows" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "workflows_status_idx" ON "workflows" USING btree ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "workflows_next_run_idx" ON "workflows" USING btree ("next_run_at");