import { and, desc, eq, ne, sql } from 'drizzle-orm';
import { getDb } from '@/server/db';
import { files, documentChunks } from '@/server/db/schema';
import type { FileRecord, Plan } from '@/server/db/schema';
import { logSecurityEvent } from '@/server/auth/events';
import { badRequest, conflict, forbidden, notFound } from '@/lib/errors';
import { getFileStorage } from './storage';
import { detectType } from './processor';
import { resolveKbAccess } from './knowledge-bases';
import { ingestFile } from './ingestion';

/**
 * File service — server-side validation, plan-limit enforcement, storage, and
 * ingestion orchestration. Browser-provided MIME type is NEVER trusted alone:
 * extension, size, a content sniff, and parser compatibility are all checked.
 */

const ALLOWED = new Set(['txt', 'text', 'md', 'markdown', 'csv', 'pdf', 'docx']);
const DEFAULT_MAX_SIZE = 15 * 1024 * 1024; // 15 MB safety default

export function fileExtension(name: string): string {
  const m = /\.([a-z0-9]+)$/i.exec(name.trim());
  return m ? m[1].toLowerCase() : '';
}

/** Light magic-byte sniff to catch misleading extensions on binary types. */
function sniffOk(ext: string, buf: Buffer): boolean {
  if (ext === 'pdf') return buf.subarray(0, 5).toString('latin1') === '%PDF-';
  if (ext === 'docx') return buf[0] === 0x50 && buf[1] === 0x4b; // ZIP (PK) container
  return true; // text types: no reliable magic; parser handles malformed content
}

export interface UploadInput {
  filename: string;
  mimeType: string;
  data: Buffer;
}

export interface FileScope {
  ownerUserId: string | null;
  organizationId: string | null;
}

/** Validate an upload against the whitelist, size, sniff, and parser support. */
export function validateUpload(input: UploadInput, plan: Pick<Plan, 'maxFileSizeBytes'>) {
  const extension = fileExtension(input.filename);
  if (!extension || !ALLOWED.has(extension)) {
    throw badRequest('Unsupported file type. Allowed: PDF, DOCX, TXT, Markdown, CSV.');
  }
  const maxSize = plan.maxFileSizeBytes ?? DEFAULT_MAX_SIZE;
  if (input.data.length === 0) throw badRequest('The file is empty.');
  if (input.data.length > maxSize) throw badRequest(`File is too large (max ${Math.floor(maxSize / 1024 / 1024)} MB).`);
  const type = detectType(extension, input.mimeType);
  if (!type) throw badRequest('Unsupported file type.');
  if (!sniffOk(extension, input.data)) throw badRequest('File content does not match its extension.');
  return { extension, type, displayName: input.filename.slice(0, 400) };
}

async function usage(scope: FileScope): Promise<{ count: number; bytes: number }> {
  const where = scope.organizationId ? eq(files.organizationId, scope.organizationId) : and(eq(files.ownerUserId, scope.ownerUserId!), sql`${files.organizationId} is null`);
  const [row] = await getDb()
    .select({ count: sql<number>`count(*)::int`, bytes: sql<number>`coalesce(sum(${files.sizeBytes}),0)::bigint` })
    .from(files)
    .where(and(where, ne(files.status, 'DELETED')));
  return { count: row?.count ?? 0, bytes: Number(row?.bytes ?? 0) };
}

/**
 * Validate, enforce plan limits, store bytes, create the record, and ingest.
 * The knowledge base must be editable by the caller (resolved server-side).
 */
export async function uploadDocument(params: {
  user: { id: string };
  knowledgeBaseId: string;
  input: UploadInput;
  plan: Plan;
}): Promise<FileRecord> {
  const { user, knowledgeBaseId, input, plan } = params;
  if (!plan.filesEligible) throw forbidden('Your plan does not include file uploads.');

  const access = await resolveKbAccess(user.id, knowledgeBaseId);
  if (!access) throw notFound('Not found');
  if (!access.canEdit) throw forbidden('You cannot add documents to this knowledge base.');

  const scope: FileScope = { ownerUserId: access.kb.ownerUserId, organizationId: access.kb.organizationId };
  const { extension, displayName } = validateUpload(input, plan);

  // Plan limits: file count + total storage.
  const used = await usage(scope);
  if (plan.maxFiles != null && used.count >= plan.maxFiles) throw conflict('You have reached your file limit for your plan.');
  if (plan.storageBytesLimit != null && used.bytes + input.data.length > plan.storageBytesLimit) {
    throw conflict('You have reached your storage limit for your plan.');
  }

  const storage = getFileStorage();
  const stored = await storage.put(input.data, { extension });

  const [record] = await getDb()
    .insert(files)
    .values({
      ownerUserId: scope.organizationId ? null : scope.ownerUserId,
      organizationId: scope.organizationId,
      uploadedByUserId: user.id,
      knowledgeBaseId,
      originalFilename: input.filename.slice(0, 400),
      displayName,
      mimeType: input.mimeType.slice(0, 160),
      extension,
      sizeBytes: stored.sizeBytes,
      storageProvider: storage.name,
      storageKey: stored.storageKey,
      status: 'UPLOADED',
    })
    .returning();

  await logSecurityEvent({
    event: 'file.uploaded',
    userId: user.id,
    actorUserId: user.id,
    organizationId: scope.organizationId,
    metadata: { fileId: record.id, kbId: knowledgeBaseId, extension, sizeBytes: stored.sizeBytes },
  });

  // Ingest inline (files are plan-bounded/small). `ingestFile` is a clean job
  // boundary a queue can call later; it never throws — status reflects outcome.
  await ingestFile(record.id);
  const [fresh] = await getDb().select().from(files).where(eq(files.id, record.id)).limit(1);
  return fresh ?? record;
}

export async function listFilesForKb(userId: string, knowledgeBaseId: string) {
  const access = await resolveKbAccess(userId, knowledgeBaseId);
  if (!access) throw notFound('Not found');
  return getDb()
    .select({
      id: files.id,
      displayName: files.displayName,
      extension: files.extension,
      sizeBytes: files.sizeBytes,
      status: files.status,
      failureReason: files.failureReason,
      pageCount: files.pageCount,
      chunkCount: files.chunkCount,
      createdAt: files.createdAt,
    })
    .from(files)
    .where(and(eq(files.knowledgeBaseId, knowledgeBaseId), ne(files.status, 'DELETED')))
    .orderBy(desc(files.createdAt));
}

/** Resolve a file the caller may access via its KB (IDOR-safe). */
export async function getAccessibleFile(userId: string, fileId: string): Promise<{ file: FileRecord; canEdit: boolean } | null> {
  const [file] = await getDb().select().from(files).where(eq(files.id, fileId)).limit(1);
  if (!file || file.status === 'DELETED' || !file.knowledgeBaseId) return null;
  const access = await resolveKbAccess(userId, file.knowledgeBaseId);
  if (!access) return null;
  return { file, canEdit: access.canEdit };
}

/** Delete a document: purge storage + chunks/vectors, mark DELETED. */
export async function deleteDocument(userId: string, fileId: string) {
  const acc = await getAccessibleFile(userId, fileId);
  if (!acc) throw notFound('Not found');
  if (!acc.canEdit) throw forbidden('You cannot delete this document.');
  const db = getDb();
  await db.delete(documentChunks).where(eq(documentChunks.documentId, fileId)); // no searchable embeddings remain
  await getFileStorage().delete(acc.file.storageKey).catch(() => {});
  await db.update(files).set({ status: 'DELETED', deletedAt: new Date(), chunkCount: 0, updatedAt: new Date() }).where(eq(files.id, fileId));
  await logSecurityEvent({ event: 'file.deleted', userId, actorUserId: userId, organizationId: acc.file.organizationId, metadata: { fileId } });
  return { ok: true };
}

/** Reprocess a document (e.g. after an embedding-model change). No duplicate chunks. */
export async function reprocessDocument(userId: string, fileId: string) {
  const acc = await getAccessibleFile(userId, fileId);
  if (!acc) throw notFound('Not found');
  if (!acc.canEdit) throw forbidden('You cannot reprocess this document.');
  await ingestFile(fileId); // idempotent — replaces prior chunks
  await logSecurityEvent({ event: 'file.reprocessed', userId, actorUserId: userId, organizationId: acc.file.organizationId, metadata: { fileId } });
  const [fresh] = await getDb().select().from(files).where(eq(files.id, fileId)).limit(1);
  return { ok: true, status: fresh?.status };
}
