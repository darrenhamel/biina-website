CREATE TYPE "public"."connection_status" AS ENUM('PENDING', 'ACTIVE', 'EXPIRED', 'REAUTH_REQUIRED', 'REVOKED', 'ERROR', 'DISABLED');--> statement-breakpoint
CREATE TYPE "public"."connection_type" AS ENUM('PERSONAL', 'ORGANIZATION');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "connections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"connector_slug" varchar(48) NOT NULL,
	"user_id" uuid,
	"organization_id" uuid,
	"connection_type" "connection_type" NOT NULL,
	"external_account_id" varchar(255),
	"external_account_email" varchar(320),
	"external_account_name" varchar(200),
	"status" "connection_status" DEFAULT 'PENDING' NOT NULL,
	"granted_scopes" jsonb DEFAULT '[]'::jsonb,
	"capabilities" jsonb DEFAULT '[]'::jsonb,
	"error" varchar(300),
	"connected_by_user_id" uuid,
	"connected_at" timestamp with time zone,
	"last_used_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "connector_credentials" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"connection_id" uuid NOT NULL,
	"ciphertext" text NOT NULL,
	"key_version" integer DEFAULT 1 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "connector_credentials_connection_id_unique" UNIQUE("connection_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "connector_definitions" (
	"slug" varchar(48) PRIMARY KEY NOT NULL,
	"display_name" varchar(120) NOT NULL,
	"provider_type" varchar(48) NOT NULL,
	"category" varchar(32) NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"supports_oauth" boolean DEFAULT true NOT NULL,
	"supports_api_key" boolean DEFAULT false NOT NULL,
	"supports_personal" boolean DEFAULT true NOT NULL,
	"supports_organization" boolean DEFAULT false NOT NULL,
	"capabilities" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"scopes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"documentation_url" varchar(300),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "connector_usage_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"connector_slug" varchar(48) NOT NULL,
	"operation" varchar(48) NOT NULL,
	"connection_id" uuid,
	"user_id" uuid,
	"organization_id" uuid,
	"resource_type" varchar(32),
	"success" boolean NOT NULL,
	"error_code" varchar(48),
	"latency_ms" integer,
	"request_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "oauth_states" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"state" varchar(96) NOT NULL,
	"user_id" uuid NOT NULL,
	"connector_slug" varchar(48) NOT NULL,
	"connection_type" "connection_type" NOT NULL,
	"organization_id" uuid,
	"code_verifier" varchar(128),
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "oauth_states_state_unique" UNIQUE("state")
);
--> statement-breakpoint
ALTER TABLE "plans" ADD COLUMN "connectors_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "plans" ADD COLUMN "max_personal_connections" integer;--> statement-breakpoint
ALTER TABLE "plans" ADD COLUMN "max_organization_connections" integer;--> statement-breakpoint
ALTER TABLE "plans" ADD COLUMN "connected_search_daily_limit" integer;--> statement-breakpoint
ALTER TABLE "plans" ADD COLUMN "connected_search_monthly_limit" integer;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "connections" ADD CONSTRAINT "connections_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "connections" ADD CONSTRAINT "connections_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "connections" ADD CONSTRAINT "connections_connected_by_user_id_users_id_fk" FOREIGN KEY ("connected_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "connector_credentials" ADD CONSTRAINT "connector_credentials_connection_id_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."connections"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "oauth_states" ADD CONSTRAINT "oauth_states_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "connections_user_idx" ON "connections" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "connections_org_idx" ON "connections" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "connections_connector_idx" ON "connections" USING btree ("connector_slug");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "connections_status_idx" ON "connections" USING btree ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "connector_usage_user_idx" ON "connector_usage_events" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "connector_usage_created_idx" ON "connector_usage_events" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "oauth_states_expires_idx" ON "oauth_states" USING btree ("expires_at");