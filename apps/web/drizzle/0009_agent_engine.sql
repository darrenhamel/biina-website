CREATE TYPE "public"."agent_action_status" AS ENUM('PROPOSED', 'AWAITING_APPROVAL', 'APPROVED', 'EXECUTING', 'SUCCEEDED', 'FAILED', 'REJECTED', 'CANCELED', 'BLOCKED', 'EXPIRED', 'UNKNOWN_OUTCOME');--> statement-breakpoint
CREATE TYPE "public"."agent_mode" AS ENUM('CHAT', 'ASSISTED', 'AGENT');--> statement-breakpoint
CREATE TYPE "public"."agent_policy_scope" AS ENUM('PLATFORM', 'ORGANIZATION', 'USER');--> statement-breakpoint
CREATE TYPE "public"."agent_session_status" AS ENUM('PENDING', 'RUNNING', 'AWAITING_APPROVAL', 'COMPLETED', 'FAILED', 'CANCELED', 'BLOCKED');--> statement-breakpoint
CREATE TYPE "public"."agent_step_status" AS ENUM('PENDING', 'RUNNING', 'SUCCEEDED', 'FAILED', 'SKIPPED');--> statement-breakpoint
CREATE TYPE "public"."approval_status" AS ENUM('PENDING', 'APPROVED', 'REJECTED', 'EXPIRED', 'CONSUMED');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "agent_actions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agent_session_id" uuid NOT NULL,
	"agent_step_id" uuid,
	"tool_id" varchar(64) NOT NULL,
	"connection_id" uuid,
	"risk_level" varchar(32) NOT NULL,
	"reversibility" varchar(24) DEFAULT 'IRREVERSIBLE' NOT NULL,
	"approval_status" varchar(24) DEFAULT 'NOT_REQUIRED' NOT NULL,
	"normalized_arguments" jsonb,
	"arguments_hash" varchar(96),
	"status" "agent_action_status" DEFAULT 'PROPOSED' NOT NULL,
	"idempotency_key" varchar(120),
	"external_resource_id" varchar(255),
	"result_summary" varchar(500),
	"error" varchar(300),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"approved_at" timestamp with time zone,
	"executed_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	CONSTRAINT "agent_actions_idem_unique" UNIQUE("agent_session_id","idempotency_key")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "agent_policies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"scope" "agent_policy_scope" NOT NULL,
	"scope_id" uuid,
	"agent_enabled" boolean,
	"write_actions_enabled" boolean,
	"email_sending_enabled" boolean,
	"calendar_actions_enabled" boolean,
	"slack_posting_enabled" boolean,
	"crm_writes_enabled" boolean,
	"max_steps_per_session" integer,
	"tool_overrides" jsonb DEFAULT '{}'::jsonb,
	"cross_connector_transfer" varchar(24),
	"updated_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agent_policies_scope_unique" UNIQUE("scope","scope_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "agent_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"organization_id" uuid,
	"conversation_id" uuid,
	"mode" "agent_mode" DEFAULT 'ASSISTED' NOT NULL,
	"status" "agent_session_status" DEFAULT 'PENDING' NOT NULL,
	"goal" text NOT NULL,
	"plan" jsonb DEFAULT '[]'::jsonb,
	"max_steps" integer DEFAULT 8 NOT NULL,
	"steps_used" integer DEFAULT 0 NOT NULL,
	"tool_calls_used" integer DEFAULT 0 NOT NULL,
	"write_actions_used" integer DEFAULT 0 NOT NULL,
	"estimated_cost" real DEFAULT 0 NOT NULL,
	"cost_budget" real,
	"currency" varchar(8) DEFAULT 'USD' NOT NULL,
	"dry_run" boolean DEFAULT false NOT NULL,
	"error" varchar(300),
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"canceled_at" timestamp with time zone,
	"deadline_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "agent_steps" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agent_session_id" uuid NOT NULL,
	"step_index" integer NOT NULL,
	"step_type" varchar(32) NOT NULL,
	"tool_id" varchar(64),
	"action_id" uuid,
	"status" "agent_step_status" DEFAULT 'PENDING' NOT NULL,
	"input_summary" varchar(500),
	"output_summary" varchar(1000),
	"request_id" uuid,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "approval_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"action_id" uuid NOT NULL,
	"agent_session_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"organization_id" uuid,
	"tool_id" varchar(64) NOT NULL,
	"risk_level" varchar(32) NOT NULL,
	"arguments_hash" varchar(96) NOT NULL,
	"preview" jsonb,
	"status" "approval_status" DEFAULT 'PENDING' NOT NULL,
	"decided_by_user_id" uuid,
	"expires_at" timestamp with time zone NOT NULL,
	"decided_at" timestamp with time zone,
	"consumed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "plans" ADD COLUMN "agent_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "plans" ADD COLUMN "agent_sessions_daily_limit" integer;--> statement-breakpoint
ALTER TABLE "plans" ADD COLUMN "agent_sessions_monthly_limit" integer;--> statement-breakpoint
ALTER TABLE "plans" ADD COLUMN "agent_max_steps_per_session" integer;--> statement-breakpoint
ALTER TABLE "plans" ADD COLUMN "agent_write_actions_daily_limit" integer;--> statement-breakpoint
ALTER TABLE "plans" ADD COLUMN "agent_external_messages_daily_limit" integer;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "agent_actions" ADD CONSTRAINT "agent_actions_agent_session_id_agent_sessions_id_fk" FOREIGN KEY ("agent_session_id") REFERENCES "public"."agent_sessions"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "agent_policies" ADD CONSTRAINT "agent_policies_updated_by_user_id_users_id_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "agent_sessions" ADD CONSTRAINT "agent_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "agent_sessions" ADD CONSTRAINT "agent_sessions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "agent_steps" ADD CONSTRAINT "agent_steps_agent_session_id_agent_sessions_id_fk" FOREIGN KEY ("agent_session_id") REFERENCES "public"."agent_sessions"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_action_id_agent_actions_id_fk" FOREIGN KEY ("action_id") REFERENCES "public"."agent_actions"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_decided_by_user_id_users_id_fk" FOREIGN KEY ("decided_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_actions_session_idx" ON "agent_actions" USING btree ("agent_session_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_actions_status_idx" ON "agent_actions" USING btree ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_actions_tool_idx" ON "agent_actions" USING btree ("tool_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_sessions_user_idx" ON "agent_sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_sessions_org_idx" ON "agent_sessions" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_sessions_status_idx" ON "agent_sessions" USING btree ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_sessions_created_idx" ON "agent_sessions" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_steps_session_idx" ON "agent_steps" USING btree ("agent_session_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "approval_requests_action_idx" ON "approval_requests" USING btree ("action_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "approval_requests_status_idx" ON "approval_requests" USING btree ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "approval_requests_expires_idx" ON "approval_requests" USING btree ("expires_at");