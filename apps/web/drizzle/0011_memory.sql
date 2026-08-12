CREATE TYPE "public"."memory_candidate_status" AS ENUM('PENDING', 'ACCEPTED', 'REJECTED', 'EXPIRED');--> statement-breakpoint
CREATE TYPE "public"."memory_owner_type" AS ENUM('PERSONAL', 'ORGANIZATION');--> statement-breakpoint
CREATE TYPE "public"."memory_scope" AS ENUM('GLOBAL', 'PERSONA', 'PROJECT', 'ORGANIZATION', 'WORKFLOW');--> statement-breakpoint
CREATE TYPE "public"."memory_sensitivity" AS ENUM('NORMAL', 'SENSITIVE', 'RESTRICTED');--> statement-breakpoint
CREATE TYPE "public"."memory_source" AS ENUM('USER_EXPLICIT', 'CONVERSATION_INFERRED', 'ADMIN_DEFINED', 'ORGANIZATION_DEFINED', 'WORKFLOW', 'IMPORT');--> statement-breakpoint
CREATE TYPE "public"."memory_status" AS ENUM('ACTIVE', 'SUPERSEDED', 'DELETED', 'EXPIRED');--> statement-breakpoint
CREATE TYPE "public"."memory_type" AS ENUM('PREFERENCE', 'PROFILE_FACT', 'PROJECT_CONTEXT', 'WORKING_RELATIONSHIP', 'ORGANIZATION_CONTEXT', 'RECURRING_INSTRUCTION', 'CUSTOM');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "conversation_summaries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"conversation_id" uuid NOT NULL,
	"summary" text NOT NULL,
	"message_count" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "conversation_summaries_conversation_id_unique" UNIQUE("conversation_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "memories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_type" "memory_owner_type" NOT NULL,
	"owner_user_id" uuid,
	"organization_id" uuid,
	"memory_type" "memory_type" DEFAULT 'PREFERENCE' NOT NULL,
	"content" varchar(2000) NOT NULL,
	"normalized_content" varchar(2000),
	"source_type" "memory_source" NOT NULL,
	"source_id" uuid,
	"scope" "memory_scope" DEFAULT 'GLOBAL' NOT NULL,
	"scope_ref" varchar(96),
	"sensitivity" "memory_sensitivity" DEFAULT 'NORMAL' NOT NULL,
	"importance" integer DEFAULT 50 NOT NULL,
	"confidence" real DEFAULT 1 NOT NULL,
	"status" "memory_status" DEFAULT 'ACTIVE' NOT NULL,
	"embedding" jsonb,
	"embedding_model" varchar(64),
	"embedding_dim" integer,
	"superseded_by_id" uuid,
	"consented_at" timestamp with time zone,
	"last_used_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "memory_candidates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_user_id" uuid NOT NULL,
	"organization_id" uuid,
	"conversation_id" uuid,
	"candidate_content" varchar(2000) NOT NULL,
	"memory_type" "memory_type" DEFAULT 'PREFERENCE' NOT NULL,
	"confidence" real DEFAULT 0.5 NOT NULL,
	"sensitivity" "memory_sensitivity" DEFAULT 'NORMAL' NOT NULL,
	"reason" varchar(300),
	"status" "memory_candidate_status" DEFAULT 'PENDING' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"decided_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "memory_revisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"memory_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"content" varchar(2000),
	"change_type" varchar(24) NOT NULL,
	"actor_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "memory_usage" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"memory_id" uuid NOT NULL,
	"request_id" uuid,
	"user_id" uuid,
	"used_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "plans" ADD COLUMN "memory_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "plans" ADD COLUMN "max_memories" integer;--> statement-breakpoint
ALTER TABLE "plans" ADD COLUMN "auto_memory_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "plans" ADD COLUMN "organization_memory_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "plans" ADD COLUMN "memory_retention_days" integer;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "response_style" varchar(16) DEFAULT 'default' NOT NULL;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "tone" varchar(16) DEFAULT 'default' NOT NULL;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "memory_enabled" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "memory_mode" varchar(8) DEFAULT 'ASK' NOT NULL;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "conversation_summaries" ADD CONSTRAINT "conversation_summaries_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "memories" ADD CONSTRAINT "memories_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "memories" ADD CONSTRAINT "memories_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "memories" ADD CONSTRAINT "memories_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "memory_candidates" ADD CONSTRAINT "memory_candidates_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "memory_revisions" ADD CONSTRAINT "memory_revisions_memory_id_memories_id_fk" FOREIGN KEY ("memory_id") REFERENCES "public"."memories"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "memory_revisions" ADD CONSTRAINT "memory_revisions_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "memory_usage" ADD CONSTRAINT "memory_usage_memory_id_memories_id_fk" FOREIGN KEY ("memory_id") REFERENCES "public"."memories"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "memories_owner_idx" ON "memories" USING btree ("owner_user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "memories_org_idx" ON "memories" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "memories_status_idx" ON "memories" USING btree ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "memories_type_idx" ON "memories" USING btree ("memory_type");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "memories_scope_idx" ON "memories" USING btree ("scope");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "memories_expires_idx" ON "memories" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "memory_candidates_owner_idx" ON "memory_candidates" USING btree ("owner_user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "memory_candidates_status_idx" ON "memory_candidates" USING btree ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "memory_revisions_memory_idx" ON "memory_revisions" USING btree ("memory_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "memory_usage_memory_idx" ON "memory_usage" USING btree ("memory_id");