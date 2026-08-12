CREATE TYPE "public"."chunk_embed_status" AS ENUM('PENDING', 'EMBEDDED', 'FAILED');--> statement-breakpoint
CREATE TYPE "public"."file_status" AS ENUM('UPLOADED', 'QUEUED', 'PROCESSING', 'READY', 'FAILED', 'DELETED', 'UNSUPPORTED');--> statement-breakpoint
CREATE TYPE "public"."kb_status" AS ENUM('ACTIVE', 'ARCHIVED');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "document_chunks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"document_id" uuid NOT NULL,
	"knowledge_base_id" uuid NOT NULL,
	"organization_id" uuid,
	"owner_user_id" uuid,
	"chunk_index" integer NOT NULL,
	"content" text NOT NULL,
	"page_number" integer,
	"section_title" varchar(300),
	"token_count" integer,
	"embedding_status" "chunk_embed_status" DEFAULT 'PENDING' NOT NULL,
	"embedding_model" varchar(120),
	"embedding_dim" integer,
	"embedding" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "files" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_user_id" uuid,
	"organization_id" uuid,
	"uploaded_by_user_id" uuid,
	"knowledge_base_id" uuid,
	"original_filename" varchar(400) NOT NULL,
	"display_name" varchar(400) NOT NULL,
	"mime_type" varchar(160) NOT NULL,
	"extension" varchar(16) NOT NULL,
	"size_bytes" integer NOT NULL,
	"storage_provider" varchar(32) NOT NULL,
	"storage_key" varchar(400) NOT NULL,
	"status" "file_status" DEFAULT 'UPLOADED' NOT NULL,
	"failure_reason" varchar(500),
	"page_count" integer,
	"chunk_count" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "knowledge_bases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(160) NOT NULL,
	"description" varchar(500),
	"owner_user_id" uuid,
	"organization_id" uuid,
	"created_by_user_id" uuid,
	"status" "kb_status" DEFAULT 'ACTIVE' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "rag_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"request_id" uuid,
	"user_id" uuid,
	"organization_id" uuid,
	"conversation_id" uuid,
	"knowledge_base_ids" jsonb,
	"retrieved_chunk_ids" jsonb,
	"scores" jsonb,
	"result_count" integer,
	"retrieval_ms" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "rag_knowledge_base_ids" jsonb;--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "rag_mode" varchar(16);--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "citations" jsonb;--> statement-breakpoint
ALTER TABLE "plans" ADD COLUMN "rag_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "plans" ADD COLUMN "org_knowledge_access" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "plans" ADD COLUMN "max_file_size_bytes" integer;--> statement-breakpoint
ALTER TABLE "plans" ADD COLUMN "max_files" integer;--> statement-breakpoint
ALTER TABLE "plans" ADD COLUMN "max_knowledge_bases" integer;--> statement-breakpoint
ALTER TABLE "plans" ADD COLUMN "storage_bytes_limit" bigint;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "document_chunks" ADD CONSTRAINT "document_chunks_document_id_files_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."files"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "document_chunks" ADD CONSTRAINT "document_chunks_knowledge_base_id_knowledge_bases_id_fk" FOREIGN KEY ("knowledge_base_id") REFERENCES "public"."knowledge_bases"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "files" ADD CONSTRAINT "files_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "files" ADD CONSTRAINT "files_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "files" ADD CONSTRAINT "files_uploaded_by_user_id_users_id_fk" FOREIGN KEY ("uploaded_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "files" ADD CONSTRAINT "files_knowledge_base_id_knowledge_bases_id_fk" FOREIGN KEY ("knowledge_base_id") REFERENCES "public"."knowledge_bases"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "knowledge_bases" ADD CONSTRAINT "knowledge_bases_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "knowledge_bases" ADD CONSTRAINT "knowledge_bases_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "knowledge_bases" ADD CONSTRAINT "knowledge_bases_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "chunks_document_idx" ON "document_chunks" USING btree ("document_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "chunks_kb_idx" ON "document_chunks" USING btree ("knowledge_base_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "chunks_org_idx" ON "document_chunks" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "chunks_owner_idx" ON "document_chunks" USING btree ("owner_user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "chunks_embed_status_idx" ON "document_chunks" USING btree ("embedding_status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "files_owner_idx" ON "files" USING btree ("owner_user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "files_org_idx" ON "files" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "files_kb_idx" ON "files" USING btree ("knowledge_base_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "files_status_idx" ON "files" USING btree ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "files_created_idx" ON "files" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "kb_owner_idx" ON "knowledge_bases" USING btree ("owner_user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "kb_org_idx" ON "knowledge_bases" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "rag_requests_user_idx" ON "rag_requests" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "rag_requests_created_idx" ON "rag_requests" USING btree ("created_at");