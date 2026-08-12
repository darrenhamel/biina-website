CREATE TYPE "public"."library_installation_status" AS ENUM('DRAFT', 'ACTIVE', 'DISABLED', 'SUSPENDED', 'UNINSTALLED');--> statement-breakpoint
CREATE TYPE "public"."library_item_status" AS ENUM('DRAFT', 'SUBMITTED', 'IN_REVIEW', 'APPROVED', 'PUBLISHED', 'REJECTED', 'SUSPENDED', 'ARCHIVED', 'DEPRECATED');--> statement-breakpoint
CREATE TYPE "public"."library_item_type" AS ENUM('PROMPT_TEMPLATE', 'AGENT_TEMPLATE', 'WORKFLOW_TEMPLATE', 'RESEARCH_TEMPLATE', 'KNOWLEDGE_TEMPLATE');--> statement-breakpoint
CREATE TYPE "public"."library_org_item_state" AS ENUM('RECOMMENDED', 'HIDDEN', 'APPROVED');--> statement-breakpoint
CREATE TYPE "public"."library_publisher_type" AS ENUM('BIINA', 'ORGANIZATION', 'USER');--> statement-breakpoint
CREATE TYPE "public"."library_review_status" AS ENUM('PENDING', 'APPROVED', 'REJECTED', 'CHANGES_REQUESTED', 'SUSPENDED');--> statement-breakpoint
CREATE TYPE "public"."library_risk_level" AS ENUM('CONTENT_ONLY', 'READ_ONLY', 'WRITE_CAPABLE', 'SCHEDULED_WRITE', 'HIGH_RISK');--> statement-breakpoint
CREATE TYPE "public"."library_version_status" AS ENUM('DRAFT', 'PUBLISHED', 'SUPERSEDED');--> statement-breakpoint
CREATE TYPE "public"."library_visibility" AS ENUM('PRIVATE', 'ORGANIZATION', 'BIINA_CURATED', 'PUBLIC');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "library_categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" varchar(64) NOT NULL,
	"label_en" varchar(120) NOT NULL,
	"label_ar" varchar(120) NOT NULL,
	"persona_scopes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"sort_order" integer DEFAULT 100 NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "library_categories_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "library_feedback" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"library_item_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"organization_id" uuid,
	"helpful" boolean,
	"rating" integer,
	"comment" varchar(1000),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "library_feedback_item_user_unique" UNIQUE("library_item_id","user_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "library_installations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"library_item_id" uuid NOT NULL,
	"version_id" uuid NOT NULL,
	"owner_type" "workflow_owner_type" NOT NULL,
	"user_id" uuid,
	"organization_id" uuid,
	"installed_definition_type" varchar(16) NOT NULL,
	"installed_definition_id" uuid,
	"local_config" jsonb,
	"status" "library_installation_status" DEFAULT 'DRAFT' NOT NULL,
	"pinned_version" boolean DEFAULT false NOT NULL,
	"installed_by_user_id" uuid,
	"installed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "library_item_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"library_item_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"status" "library_version_status" DEFAULT 'DRAFT' NOT NULL,
	"configuration_snapshot" jsonb NOT NULL,
	"manifest" jsonb NOT NULL,
	"change_notes" varchar(600),
	"risk_level" "library_risk_level" DEFAULT 'CONTENT_ONLY' NOT NULL,
	"required_tools" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"required_connectors" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"required_capabilities" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"required_plans" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"supported_personas" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"validation_result" jsonb,
	"config_hash" varchar(96) NOT NULL,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"published_at" timestamp with time zone,
	CONSTRAINT "library_item_versions_unique" UNIQUE("library_item_id","version")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "library_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" varchar(140) NOT NULL,
	"item_type" "library_item_type" NOT NULL,
	"title" varchar(200) NOT NULL,
	"title_ar" varchar(200),
	"short_description" varchar(400) DEFAULT '' NOT NULL,
	"short_description_ar" varchar(400),
	"long_description" text,
	"long_description_ar" text,
	"publisher_type" "library_publisher_type" NOT NULL,
	"publisher_user_id" uuid,
	"publisher_organization_id" uuid,
	"visibility" "library_visibility" DEFAULT 'PRIVATE' NOT NULL,
	"status" "library_item_status" DEFAULT 'DRAFT' NOT NULL,
	"current_version_id" uuid,
	"categories" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"tags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"supported_personas" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"required_plans" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"required_capabilities" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"required_connectors" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"required_tools" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"risk_level" "library_risk_level" DEFAULT 'CONTENT_ONLY' NOT NULL,
	"featured" boolean DEFAULT false NOT NULL,
	"verified" boolean DEFAULT false NOT NULL,
	"installation_count" integer DEFAULT 0 NOT NULL,
	"successful_runs" integer DEFAULT 0 NOT NULL,
	"failed_runs" integer DEFAULT 0 NOT NULL,
	"blocked_actions" integer DEFAULT 0 NOT NULL,
	"rating_sum" integer DEFAULT 0 NOT NULL,
	"rating_count" integer DEFAULT 0 NOT NULL,
	"creator_id" uuid,
	"monetization_status" varchar(24) DEFAULT 'FREE' NOT NULL,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"published_at" timestamp with time zone,
	CONSTRAINT "library_items_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "library_org_curation" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"library_item_id" uuid NOT NULL,
	"state" "library_org_item_state" NOT NULL,
	"pinned_version_id" uuid,
	"set_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "library_org_curation_unique" UNIQUE("organization_id","library_item_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "library_org_settings" (
	"organization_id" uuid PRIMARY KEY NOT NULL,
	"public_library_enabled" boolean DEFAULT true NOT NULL,
	"install_policy" varchar(16) DEFAULT 'OPEN' NOT NULL,
	"write_capable_allowed" boolean DEFAULT true NOT NULL,
	"updated_by_user_id" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "library_reviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"library_item_id" uuid NOT NULL,
	"version_id" uuid,
	"status" "library_review_status" DEFAULT 'PENDING' NOT NULL,
	"risk_level" "library_risk_level" DEFAULT 'CONTENT_ONLY' NOT NULL,
	"validation_result" jsonb,
	"reviewer_user_id" uuid,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"decided_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "publisher_profiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"organization_id" uuid,
	"display_name" varchar(160) NOT NULL,
	"publisher_type" "library_publisher_type" NOT NULL,
	"verification_status" varchar(16) DEFAULT 'UNVERIFIED' NOT NULL,
	"monetization_status" varchar(24) DEFAULT 'NONE' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "plans" ADD COLUMN "library_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "plans" ADD COLUMN "agent_library_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "plans" ADD COLUMN "workflow_library_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "plans" ADD COLUMN "organization_library_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "plans" ADD COLUMN "public_library_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "plans" ADD COLUMN "max_installed_agents" integer;--> statement-breakpoint
ALTER TABLE "plans" ADD COLUMN "max_installed_workflows" integer;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "library_feedback" ADD CONSTRAINT "library_feedback_library_item_id_library_items_id_fk" FOREIGN KEY ("library_item_id") REFERENCES "public"."library_items"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "library_feedback" ADD CONSTRAINT "library_feedback_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "library_installations" ADD CONSTRAINT "library_installations_library_item_id_library_items_id_fk" FOREIGN KEY ("library_item_id") REFERENCES "public"."library_items"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "library_installations" ADD CONSTRAINT "library_installations_version_id_library_item_versions_id_fk" FOREIGN KEY ("version_id") REFERENCES "public"."library_item_versions"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "library_installations" ADD CONSTRAINT "library_installations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "library_installations" ADD CONSTRAINT "library_installations_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "library_installations" ADD CONSTRAINT "library_installations_installed_by_user_id_users_id_fk" FOREIGN KEY ("installed_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "library_item_versions" ADD CONSTRAINT "library_item_versions_library_item_id_library_items_id_fk" FOREIGN KEY ("library_item_id") REFERENCES "public"."library_items"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "library_item_versions" ADD CONSTRAINT "library_item_versions_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "library_items" ADD CONSTRAINT "library_items_publisher_user_id_users_id_fk" FOREIGN KEY ("publisher_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "library_items" ADD CONSTRAINT "library_items_publisher_organization_id_organizations_id_fk" FOREIGN KEY ("publisher_organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "library_items" ADD CONSTRAINT "library_items_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "library_org_curation" ADD CONSTRAINT "library_org_curation_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "library_org_curation" ADD CONSTRAINT "library_org_curation_library_item_id_library_items_id_fk" FOREIGN KEY ("library_item_id") REFERENCES "public"."library_items"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "library_org_settings" ADD CONSTRAINT "library_org_settings_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "library_reviews" ADD CONSTRAINT "library_reviews_library_item_id_library_items_id_fk" FOREIGN KEY ("library_item_id") REFERENCES "public"."library_items"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "library_reviews" ADD CONSTRAINT "library_reviews_version_id_library_item_versions_id_fk" FOREIGN KEY ("version_id") REFERENCES "public"."library_item_versions"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "library_reviews" ADD CONSTRAINT "library_reviews_reviewer_user_id_users_id_fk" FOREIGN KEY ("reviewer_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "publisher_profiles" ADD CONSTRAINT "publisher_profiles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "publisher_profiles" ADD CONSTRAINT "publisher_profiles_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "library_categories_enabled_idx" ON "library_categories" USING btree ("enabled");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "library_installations_user_idx" ON "library_installations" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "library_installations_org_idx" ON "library_installations" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "library_installations_item_idx" ON "library_installations" USING btree ("library_item_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "library_items_type_idx" ON "library_items" USING btree ("item_type");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "library_items_status_idx" ON "library_items" USING btree ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "library_items_visibility_idx" ON "library_items" USING btree ("visibility");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "library_items_pub_user_idx" ON "library_items" USING btree ("publisher_user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "library_items_pub_org_idx" ON "library_items" USING btree ("publisher_organization_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "library_items_featured_idx" ON "library_items" USING btree ("featured");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "library_items_published_idx" ON "library_items" USING btree ("published_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "library_org_curation_org_idx" ON "library_org_curation" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "library_reviews_status_idx" ON "library_reviews" USING btree ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "library_reviews_item_idx" ON "library_reviews" USING btree ("library_item_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "publisher_profiles_user_idx" ON "publisher_profiles" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "publisher_profiles_org_idx" ON "publisher_profiles" USING btree ("organization_id");