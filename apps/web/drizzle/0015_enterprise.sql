CREATE TYPE "public"."audit_level" AS ENUM('MINIMAL', 'STANDARD', 'DETAILED');--> statement-breakpoint
CREATE TYPE "public"."data_classification" AS ENUM('PUBLIC', 'INTERNAL', 'CONFIDENTIAL', 'RESTRICTED');--> statement-breakpoint
CREATE TYPE "public"."deployment_type" AS ENUM('SHARED_SAAS', 'DEDICATED_TENANT', 'PRIVATE_CLOUD', 'SOVEREIGN', 'ON_PREMISE_READY');--> statement-breakpoint
CREATE TYPE "public"."domain_status" AS ENUM('PENDING', 'VERIFIED', 'FAILED', 'REVOKED');--> statement-breakpoint
CREATE TYPE "public"."identity_provider_type" AS ENUM('OIDC', 'SAML');--> statement-breakpoint
CREATE TYPE "public"."service_account_status" AS ENUM('ACTIVE', 'DISABLED', 'EXPIRED');--> statement-breakpoint
CREATE TYPE "public"."tenant_isolation_mode" AS ENUM('SHARED_DATABASE_TENANT_ISOLATION', 'DEDICATED_DATABASE');--> statement-breakpoint
ALTER TYPE "public"."org_status" ADD VALUE 'ARCHIVED';--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "data_residency_policies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid,
	"name" varchar(120) NOT NULL,
	"allowed_regions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"required_regions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"storage_region" varchar(32),
	"vector_region" varchar(32),
	"model_inference_region" varchar(32),
	"external_transfer_allowed" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "deployment_profiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" varchar(64) NOT NULL,
	"display_name" varchar(120) NOT NULL,
	"deployment_type" "deployment_type" DEFAULT 'SHARED_SAAS' NOT NULL,
	"region" varchar(32) DEFAULT 'OTHER' NOT NULL,
	"jurisdiction_label" varchar(120),
	"tenant_isolation_mode" "tenant_isolation_mode" DEFAULT 'SHARED_DATABASE_TENANT_ISOLATION' NOT NULL,
	"allowed_provider_regions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"allowed_model_providers" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"external_ai_allowed" boolean DEFAULT true NOT NULL,
	"external_web_search_allowed" boolean DEFAULT true NOT NULL,
	"external_connectors_allowed" boolean DEFAULT true NOT NULL,
	"private_storage_required" boolean DEFAULT false NOT NULL,
	"private_vector_store_required" boolean DEFAULT false NOT NULL,
	"audit_level" "audit_level" DEFAULT 'STANDARD' NOT NULL,
	"retention_policy_id" uuid,
	"privileged" boolean DEFAULT false NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "deployment_profiles_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "organization_config_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"kind" varchar(32) NOT NULL,
	"snapshot" jsonb NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "organization_group_members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"group_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "org_group_members_uniq" UNIQUE("group_id","user_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "organization_groups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" varchar(160) NOT NULL,
	"description" varchar(400),
	"group_type" varchar(24) DEFAULT 'TEAM' NOT NULL,
	"scim_external_id" varchar(128),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "org_groups_org_name_uniq" UNIQUE("organization_id","name")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "organization_identity_providers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"type" "identity_provider_type" NOT NULL,
	"display_name" varchar(120) NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"issuer" varchar(400),
	"client_id_ref" varchar(96),
	"client_secret_ref" varchar(96),
	"metadata_ref" varchar(96),
	"sp_entity_id" varchar(400),
	"acs_url" varchar(400),
	"idp_cert_ref" varchar(96),
	"attribute_mappings" jsonb DEFAULT '{}'::jsonb,
	"enforce_sso" boolean DEFAULT false NOT NULL,
	"allow_password_fallback" boolean DEFAULT true NOT NULL,
	"domain_restriction" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "organization_role_definitions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"slug" varchar(48) NOT NULL,
	"name" varchar(120) NOT NULL,
	"description" varchar(400),
	"permissions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"system_role" boolean DEFAULT false NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "org_role_defs_org_slug_uniq" UNIQUE("organization_id","slug")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "organization_security_policies" (
	"organization_id" uuid PRIMARY KEY NOT NULL,
	"allowed_ai_providers" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"allowed_model_profiles" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"external_ai_allowed" boolean DEFAULT true NOT NULL,
	"web_search_mode" varchar(20) DEFAULT 'STANDARD' NOT NULL,
	"approved_research_domains" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"personal_connectors_allowed" boolean DEFAULT true NOT NULL,
	"organization_connectors_required" boolean DEFAULT false NOT NULL,
	"allowed_connectors" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"agents_enabled" boolean DEFAULT true NOT NULL,
	"external_writes_enabled" boolean DEFAULT true NOT NULL,
	"standing_authorizations_allowed" boolean DEFAULT true NOT NULL,
	"max_agent_steps" integer,
	"scheduled_automations_enabled" boolean DEFAULT true NOT NULL,
	"scheduled_writes_enabled" boolean DEFAULT true NOT NULL,
	"memory_enabled" boolean DEFAULT true NOT NULL,
	"multimodal_enabled" boolean DEFAULT true NOT NULL,
	"research_enabled" boolean DEFAULT true NOT NULL,
	"research_external_web_allowed" boolean DEFAULT true NOT NULL,
	"research_max_depth" varchar(12),
	"marketplace_mode" varchar(20) DEFAULT 'PUBLIC_ALLOWED' NOT NULL,
	"data_export_allowed" boolean DEFAULT true NOT NULL,
	"default_data_classification" "data_classification" DEFAULT 'INTERNAL' NOT NULL,
	"session_max_minutes" integer,
	"idle_timeout_minutes" integer,
	"sso_reauth_minutes" integer,
	"ip_allowlist" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"mfa_required" boolean DEFAULT false NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"updated_by_user_id" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "retention_policies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid,
	"name" varchar(120) NOT NULL,
	"conversation_retention_days" integer,
	"file_retention_days" integer,
	"audit_retention_days" integer,
	"memory_retention_days" integer,
	"research_retention_days" integer,
	"workflow_run_retention_days" integer,
	"deletion_mode" varchar(16) DEFAULT 'SOFT_DELETE' NOT NULL,
	"legal_hold_enabled" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "scim_configurations" (
	"organization_id" uuid PRIMARY KEY NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"token_hash" varchar(64),
	"token_prefix" varchar(16),
	"token_last_four" varchar(8),
	"default_role" "org_role" DEFAULT 'MEMBER' NOT NULL,
	"last_used_at" timestamp with time zone,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "service_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" varchar(120) NOT NULL,
	"token_hash" varchar(64),
	"token_prefix" varchar(16),
	"scopes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" "service_account_status" DEFAULT 'DISABLED' NOT NULL,
	"expires_at" timestamp with time zone,
	"last_used_at" timestamp with time zone,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "verified_domains" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"domain" varchar(253) NOT NULL,
	"status" "domain_status" DEFAULT 'PENDING' NOT NULL,
	"verification_method" varchar(24) DEFAULT 'DNS_TXT' NOT NULL,
	"verification_token_hash" varchar(64) NOT NULL,
	"verified_at" timestamp with time zone,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ai_providers" ADD COLUMN "owner_type" varchar(16) DEFAULT 'PLATFORM' NOT NULL;--> statement-breakpoint
ALTER TABLE "ai_providers" ADD COLUMN "owner_organization_id" uuid;--> statement-breakpoint
ALTER TABLE "ai_providers" ADD COLUMN "is_external" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "ai_providers" ADD COLUMN "private_endpoint" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "organization_members" ADD COLUMN "role_definition_id" uuid;--> statement-breakpoint
ALTER TABLE "organization_members" ADD COLUMN "managed_by_scim" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "organization_members" ADD COLUMN "scim_external_id" varchar(128);--> statement-breakpoint
ALTER TABLE "organization_members" ADD COLUMN "active" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "deployment_profile_id" uuid;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "archived_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "plans" ADD COLUMN "enterprise_features_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "plans" ADD COLUMN "sso_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "plans" ADD COLUMN "scim_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "plans" ADD COLUMN "dedicated_provider_allowed" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "plans" ADD COLUMN "data_residency_controls" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "plans" ADD COLUMN "audit_export_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "plans" ADD COLUMN "custom_roles_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "plans" ADD COLUMN "max_organization_groups" integer;--> statement-breakpoint
ALTER TABLE "plans" ADD COLUMN "max_custom_roles" integer;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "account_type" varchar(24) DEFAULT 'PERSONAL' NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "managed_by_organization_id" uuid;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "data_residency_policies" ADD CONSTRAINT "data_residency_policies_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "organization_config_snapshots" ADD CONSTRAINT "organization_config_snapshots_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "organization_group_members" ADD CONSTRAINT "organization_group_members_group_id_organization_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."organization_groups"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "organization_group_members" ADD CONSTRAINT "organization_group_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "organization_groups" ADD CONSTRAINT "organization_groups_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "organization_identity_providers" ADD CONSTRAINT "organization_identity_providers_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "organization_role_definitions" ADD CONSTRAINT "organization_role_definitions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "organization_security_policies" ADD CONSTRAINT "organization_security_policies_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "retention_policies" ADD CONSTRAINT "retention_policies_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "scim_configurations" ADD CONSTRAINT "scim_configurations_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "service_accounts" ADD CONSTRAINT "service_accounts_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "verified_domains" ADD CONSTRAINT "verified_domains_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "org_config_snapshots_org_kind_idx" ON "organization_config_snapshots" USING btree ("organization_id","kind");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "org_group_members_group_idx" ON "organization_group_members" USING btree ("group_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "org_groups_org_idx" ON "organization_groups" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "org_idp_org_idx" ON "organization_identity_providers" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "org_role_defs_org_idx" ON "organization_role_definitions" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "service_accounts_org_idx" ON "service_accounts" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "verified_domains_active_uniq" ON "verified_domains" USING btree ("domain") WHERE status <> 'REVOKED';--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "verified_domains_org_idx" ON "verified_domains" USING btree ("organization_id");