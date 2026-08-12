CREATE TYPE "public"."billing_interval" AS ENUM('month', 'year');--> statement-breakpoint
CREATE TYPE "public"."billing_provider" AS ENUM('stripe');--> statement-breakpoint
CREATE TYPE "public"."subscription_status" AS ENUM('TRIALING', 'ACTIVE', 'PAST_DUE', 'CANCELED', 'INCOMPLETE', 'UNPAID', 'PAUSED');--> statement-breakpoint
CREATE TYPE "public"."billing_webhook_status" AS ENUM('received', 'processed', 'failed');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "billing_config" (
	"id" varchar(16) PRIMARY KEY DEFAULT 'singleton' NOT NULL,
	"default_currency" varchar(8) DEFAULT 'AED' NOT NULL,
	"tax_enabled" boolean DEFAULT false NOT NULL,
	"tax_mode" varchar(24) DEFAULT 'none' NOT NULL,
	"tax_inclusive" boolean DEFAULT false NOT NULL,
	"tax_registration_number" varchar(64),
	"tax_rate_reference" varchar(120),
	"legal_entity_name" varchar(200),
	"billing_country" varchar(2) DEFAULT 'AE',
	"support_email" varchar(320),
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "billing_customers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"organization_id" uuid,
	"billing_provider" "billing_provider" DEFAULT 'stripe' NOT NULL,
	"provider_customer_id" varchar(255) NOT NULL,
	"email" varchar(320),
	"billing_name" varchar(200),
	"billing_country" varchar(2),
	"tax_registration_number" varchar(64),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "billing_customers_provider_customer_uniq" UNIQUE("billing_provider","provider_customer_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "billing_invoices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"subscription_id" uuid,
	"billing_customer_id" uuid,
	"billing_provider" "billing_provider" DEFAULT 'stripe' NOT NULL,
	"provider_invoice_id" varchar(255) NOT NULL,
	"status" varchar(32),
	"currency" varchar(8),
	"subtotal" integer,
	"tax" integer,
	"total" integer,
	"period_start" timestamp with time zone,
	"period_end" timestamp with time zone,
	"invoice_url" text,
	"invoice_pdf_url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "billing_invoices_provider_invoice_id_unique" UNIQUE("provider_invoice_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "billing_webhook_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"billing_provider" "billing_provider" DEFAULT 'stripe' NOT NULL,
	"provider_event_id" varchar(255) NOT NULL,
	"event_type" varchar(120) NOT NULL,
	"status" "billing_webhook_status" DEFAULT 'received' NOT NULL,
	"error" text,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone,
	CONSTRAINT "billing_webhook_events_provider_event_id_unique" UNIQUE("provider_event_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "commercial_prices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"plan_slug" varchar(32) NOT NULL,
	"display_name" varchar(120) NOT NULL,
	"billing_provider" "billing_provider" DEFAULT 'stripe' NOT NULL,
	"provider_price_id" varchar(255) NOT NULL,
	"currency" varchar(8) NOT NULL,
	"amount" integer NOT NULL,
	"billing_interval" "billing_interval" DEFAULT 'month' NOT NULL,
	"billing_interval_count" integer DEFAULT 1 NOT NULL,
	"trial_days" integer,
	"included_seats" integer,
	"max_seats" integer,
	"per_seat_billing" boolean DEFAULT false NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"publicly_available" boolean DEFAULT true NOT NULL,
	"is_test" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "commercial_prices_provider_price_uniq" UNIQUE("billing_provider","provider_price_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "subscriptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"organization_id" uuid,
	"plan_slug" varchar(32) NOT NULL,
	"commercial_price_id" uuid,
	"billing_provider" "billing_provider" DEFAULT 'stripe' NOT NULL,
	"provider_customer_id" varchar(255),
	"provider_subscription_id" varchar(255) NOT NULL,
	"status" "subscription_status" NOT NULL,
	"current_period_start" timestamp with time zone,
	"current_period_end" timestamp with time zone,
	"cancel_at_period_end" boolean DEFAULT false NOT NULL,
	"canceled_at" timestamp with time zone,
	"trial_start" timestamp with time zone,
	"trial_end" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "subscriptions_provider_subscription_id_unique" UNIQUE("provider_subscription_id")
);
--> statement-breakpoint
ALTER TABLE "plan_assignments" ADD COLUMN "source" varchar(24) DEFAULT 'MANUAL' NOT NULL;--> statement-breakpoint
ALTER TABLE "plan_assignments" ADD COLUMN "subscription_id" uuid;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "billing_customers" ADD CONSTRAINT "billing_customers_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "billing_customers" ADD CONSTRAINT "billing_customers_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "billing_customers_user_idx" ON "billing_customers" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "billing_customers_org_idx" ON "billing_customers" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "billing_invoices_sub_idx" ON "billing_invoices" USING btree ("subscription_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "billing_invoices_customer_idx" ON "billing_invoices" USING btree ("billing_customer_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "commercial_prices_plan_idx" ON "commercial_prices" USING btree ("plan_slug");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "subscriptions_user_idx" ON "subscriptions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "subscriptions_org_idx" ON "subscriptions" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "subscriptions_status_idx" ON "subscriptions" USING btree ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "plan_assignments_source_idx" ON "plan_assignments" USING btree ("user_id","source");