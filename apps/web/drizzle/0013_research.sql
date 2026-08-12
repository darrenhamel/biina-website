CREATE TYPE "public"."finding_status" AS ENUM('SUPPORTED', 'PARTIALLY_SUPPORTED', 'CONFLICTING', 'UNVERIFIED');--> statement-breakpoint
CREATE TYPE "public"."research_conflict_status" AS ENUM('OPEN', 'RESOLVED', 'UNRESOLVED');--> statement-breakpoint
CREATE TYPE "public"."research_depth" AS ENUM('QUICK', 'STANDARD', 'DEEP');--> statement-breakpoint
CREATE TYPE "public"."research_source_type" AS ENUM('PUBLIC_WEB', 'PRIMARY_OFFICIAL_SOURCE', 'PRIVATE_DOCUMENT', 'KNOWLEDGE_BASE', 'CONNECTED_EMAIL', 'CONNECTED_FILE', 'CONNECTED_MESSAGE', 'CONNECTED_RECORD', 'MULTIMODAL_SOURCE');--> statement-breakpoint
CREATE TYPE "public"."research_status" AS ENUM('PLANNING', 'RUNNING', 'SYNTHESIZING', 'AWAITING_APPROVAL', 'COMPLETED', 'PARTIALLY_COMPLETED', 'FAILED', 'CANCELED', 'BLOCKED');--> statement-breakpoint
CREATE TYPE "public"."research_task_status" AS ENUM('PENDING', 'RUNNING', 'COMPLETED', 'FAILED', 'SKIPPED', 'BLOCKED');--> statement-breakpoint
CREATE TYPE "public"."research_task_type" AS ENUM('WEB_RESEARCH', 'PRIVATE_KNOWLEDGE_RESEARCH', 'CONNECTED_DATA_RESEARCH', 'DOCUMENT_ANALYSIS', 'COMPARISON', 'VERIFICATION', 'SYNTHESIS_SUPPORT');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "research_conflicts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"research_session_id" uuid NOT NULL,
	"topic" varchar(500) NOT NULL,
	"evidence_a_id" uuid,
	"evidence_b_id" uuid,
	"status" "research_conflict_status" DEFAULT 'OPEN' NOT NULL,
	"resolution_summary" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "research_evidence" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"research_session_id" uuid NOT NULL,
	"task_id" uuid,
	"source_type" "research_source_type" NOT NULL,
	"source_id" varchar(400),
	"title" varchar(400),
	"source_reference" varchar(500),
	"excerpt" text,
	"published_at" timestamp with time zone,
	"retrieved_at" timestamp with time zone DEFAULT now() NOT NULL,
	"relevance_score" real,
	"quality_metadata" jsonb,
	"content_hash" varchar(64),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "research_findings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"research_session_id" uuid NOT NULL,
	"task_id" uuid,
	"claim" varchar(1000) NOT NULL,
	"summary" text,
	"evidence_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"confidence" real DEFAULT 0.5 NOT NULL,
	"status" "finding_status" DEFAULT 'UNVERIFIED' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "research_results" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"research_session_id" uuid NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"executive_summary" text,
	"findings" jsonb,
	"analysis" text,
	"recommendations" text,
	"uncertainties" jsonb DEFAULT '[]'::jsonb,
	"citation_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"partial" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "research_results_session_version_unique" UNIQUE("research_session_id","version")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "research_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"organization_id" uuid,
	"conversation_id" uuid,
	"objective" text NOT NULL,
	"status" "research_status" DEFAULT 'PLANNING' NOT NULL,
	"depth" "research_depth" DEFAULT 'STANDARD' NOT NULL,
	"max_tasks" integer DEFAULT 4 NOT NULL,
	"max_agent_runs" integer DEFAULT 6 NOT NULL,
	"max_sources" integer DEFAULT 20 NOT NULL,
	"max_parallel_agents" integer DEFAULT 3 NOT NULL,
	"max_cost" real,
	"max_duration_ms" integer DEFAULT 180000 NOT NULL,
	"tasks_created" integer DEFAULT 0 NOT NULL,
	"tasks_completed" integer DEFAULT 0 NOT NULL,
	"sources_collected" integer DEFAULT 0 NOT NULL,
	"agent_runs_used" integer DEFAULT 0 NOT NULL,
	"estimated_cost" real DEFAULT 0 NOT NULL,
	"plan" jsonb,
	"knowledge_base_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"connection_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"web_enabled" boolean DEFAULT true NOT NULL,
	"error" varchar(400),
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"canceled_at" timestamp with time zone,
	"deadline_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "research_tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"research_session_id" uuid NOT NULL,
	"title" varchar(240) NOT NULL,
	"objective" text NOT NULL,
	"task_type" "research_task_type" NOT NULL,
	"status" "research_task_status" DEFAULT 'PENDING' NOT NULL,
	"priority" integer DEFAULT 100 NOT NULL,
	"assigned_profile" varchar(48) NOT NULL,
	"allowed_tools" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"allowed_source_types" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"scope" varchar(400),
	"max_sources" integer DEFAULT 6 NOT NULL,
	"max_cost" real,
	"depends_on_task_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"error" varchar(400),
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "plans" ADD COLUMN "advanced_research_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "plans" ADD COLUMN "deep_research_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "plans" ADD COLUMN "research_runs_per_month" integer;--> statement-breakpoint
ALTER TABLE "plans" ADD COLUMN "max_research_tasks" integer;--> statement-breakpoint
ALTER TABLE "plans" ADD COLUMN "max_sources_per_research" integer;--> statement-breakpoint
ALTER TABLE "plans" ADD COLUMN "max_parallel_agents" integer;--> statement-breakpoint
ALTER TABLE "plans" ADD COLUMN "max_research_cost" real;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "research_conflicts" ADD CONSTRAINT "research_conflicts_research_session_id_research_sessions_id_fk" FOREIGN KEY ("research_session_id") REFERENCES "public"."research_sessions"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "research_evidence" ADD CONSTRAINT "research_evidence_research_session_id_research_sessions_id_fk" FOREIGN KEY ("research_session_id") REFERENCES "public"."research_sessions"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "research_findings" ADD CONSTRAINT "research_findings_research_session_id_research_sessions_id_fk" FOREIGN KEY ("research_session_id") REFERENCES "public"."research_sessions"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "research_results" ADD CONSTRAINT "research_results_research_session_id_research_sessions_id_fk" FOREIGN KEY ("research_session_id") REFERENCES "public"."research_sessions"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "research_sessions" ADD CONSTRAINT "research_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "research_sessions" ADD CONSTRAINT "research_sessions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "research_tasks" ADD CONSTRAINT "research_tasks_research_session_id_research_sessions_id_fk" FOREIGN KEY ("research_session_id") REFERENCES "public"."research_sessions"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "research_conflicts_session_idx" ON "research_conflicts" USING btree ("research_session_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "research_evidence_session_idx" ON "research_evidence" USING btree ("research_session_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "research_evidence_task_idx" ON "research_evidence" USING btree ("task_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "research_findings_session_idx" ON "research_findings" USING btree ("research_session_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "research_findings_task_idx" ON "research_findings" USING btree ("task_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "research_sessions_user_idx" ON "research_sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "research_sessions_org_idx" ON "research_sessions" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "research_sessions_status_idx" ON "research_sessions" USING btree ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "research_sessions_created_idx" ON "research_sessions" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "research_tasks_session_idx" ON "research_tasks" USING btree ("research_session_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "research_tasks_status_idx" ON "research_tasks" USING btree ("status");