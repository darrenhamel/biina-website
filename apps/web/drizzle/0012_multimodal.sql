CREATE TYPE "public"."media_job_type" AS ENUM('OCR', 'TRANSCRIBE');--> statement-breakpoint
CREATE TYPE "public"."media_status" AS ENUM('UPLOADED', 'QUEUED', 'PROCESSING', 'READY', 'FAILED', 'DELETED');--> statement-breakpoint
CREATE TYPE "public"."media_type" AS ENUM('IMAGE', 'AUDIO', 'VIDEO');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "audio_transcripts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"media_asset_id" uuid NOT NULL,
	"text" text NOT NULL,
	"language" varchar(16),
	"segments" jsonb,
	"duration_ms" integer,
	"confidence" real,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "audio_transcripts_media_asset_id_unique" UNIQUE("media_asset_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "media_assets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_user_id" uuid,
	"organization_id" uuid,
	"uploaded_by_user_id" uuid,
	"conversation_id" uuid,
	"media_type" "media_type" NOT NULL,
	"mime_type" varchar(160) NOT NULL,
	"size_bytes" integer NOT NULL,
	"storage_provider" varchar(32) NOT NULL,
	"storage_key" varchar(400) NOT NULL,
	"sha256" varchar(64),
	"width" integer,
	"height" integer,
	"duration_ms" integer,
	"status" "media_status" DEFAULT 'UPLOADED' NOT NULL,
	"failure_reason" varchar(400),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "media_processing_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"media_asset_id" uuid NOT NULL,
	"job_type" "media_job_type" NOT NULL,
	"status" "media_status" DEFAULT 'QUEUED' NOT NULL,
	"attempt" integer DEFAULT 1 NOT NULL,
	"error" varchar(400),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	CONSTRAINT "media_jobs_unique" UNIQUE("media_asset_id","job_type")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "media_usage_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"operation" varchar(24) NOT NULL,
	"user_id" uuid,
	"organization_id" uuid,
	"media_asset_id" uuid,
	"provider" varchar(48),
	"units" integer,
	"unit_kind" varchar(24),
	"estimated_cost" real,
	"currency" varchar(8) DEFAULT 'USD' NOT NULL,
	"success" boolean NOT NULL,
	"error_code" varchar(48),
	"request_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "voice_profiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" varchar(48) NOT NULL,
	"display_name" varchar(80) NOT NULL,
	"provider" varchar(32) NOT NULL,
	"provider_voice_id" varchar(96) NOT NULL,
	"language" varchar(16) DEFAULT 'en' NOT NULL,
	"locale" varchar(16),
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "voice_profiles_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "media_asset_ids" jsonb;--> statement-breakpoint
ALTER TABLE "plans" ADD COLUMN "vision_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "plans" ADD COLUMN "max_images_per_request" integer;--> statement-breakpoint
ALTER TABLE "plans" ADD COLUMN "image_uploads_per_day" integer;--> statement-breakpoint
ALTER TABLE "plans" ADD COLUMN "ocr_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "plans" ADD COLUMN "ocr_pages_per_month" integer;--> statement-breakpoint
ALTER TABLE "plans" ADD COLUMN "speech_to_text_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "plans" ADD COLUMN "audio_minutes_per_month" integer;--> statement-breakpoint
ALTER TABLE "plans" ADD COLUMN "text_to_speech_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "plans" ADD COLUMN "tts_characters_per_month" integer;--> statement-breakpoint
ALTER TABLE "plans" ADD COLUMN "voice_mode_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "plans" ADD COLUMN "voice_minutes_per_month" integer;--> statement-breakpoint
ALTER TABLE "plans" ADD COLUMN "media_storage_bytes_limit" bigint;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "audio_transcripts" ADD CONSTRAINT "audio_transcripts_media_asset_id_media_assets_id_fk" FOREIGN KEY ("media_asset_id") REFERENCES "public"."media_assets"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "media_assets" ADD CONSTRAINT "media_assets_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "media_assets" ADD CONSTRAINT "media_assets_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "media_assets" ADD CONSTRAINT "media_assets_uploaded_by_user_id_users_id_fk" FOREIGN KEY ("uploaded_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "media_processing_jobs" ADD CONSTRAINT "media_processing_jobs_media_asset_id_media_assets_id_fk" FOREIGN KEY ("media_asset_id") REFERENCES "public"."media_assets"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "media_owner_idx" ON "media_assets" USING btree ("owner_user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "media_org_idx" ON "media_assets" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "media_conversation_idx" ON "media_assets" USING btree ("conversation_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "media_type_idx" ON "media_assets" USING btree ("media_type");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "media_status_idx" ON "media_assets" USING btree ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "media_usage_user_idx" ON "media_usage_events" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "media_usage_op_idx" ON "media_usage_events" USING btree ("operation");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "media_usage_created_idx" ON "media_usage_events" USING btree ("created_at");