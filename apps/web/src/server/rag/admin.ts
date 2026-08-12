import { and, desc, eq, gte, ilike, ne, or, sql } from 'drizzle-orm';
import { getDb } from '@/server/db';
import { files, documentChunks, ragRequests, knowledgeBases, users, organizations } from '@/server/db/schema';
import { getEmbeddingProvider } from './embeddings';
import { getVectorStore } from './vector-store';
import { getFileStorage } from './storage';
import { embeddingConfig } from './config';

/**
 * Admin RAG operations — OPERATIONAL METADATA ONLY. No private document content
 * is ever surfaced. Document search is limited to non-content fields for support.
 */

export async function ragOverview() {
  const db = getDb();
  const now = new Date();
  const dayAgo = new Date(now.getTime() - 86_400_000);

  const [fileAgg] = await db
    .select({
      total: sql<number>`count(*) filter (where ${files.status} <> 'DELETED')::int`,
      ready: sql<number>`count(*) filter (where ${files.status} = 'READY')::int`,
      failed: sql<number>`count(*) filter (where ${files.status} in ('FAILED','UNSUPPORTED'))::int`,
      processing: sql<number>`count(*) filter (where ${files.status} in ('PROCESSING','QUEUED','UPLOADED'))::int`,
      bytes: sql<number>`coalesce(sum(${files.sizeBytes}) filter (where ${files.status} <> 'DELETED'),0)::bigint`,
    })
    .from(files);
  const [chunkAgg] = await db.select({ chunks: sql<number>`count(*)::int` }).from(documentChunks);
  const [kbAgg] = await db.select({ kbs: sql<number>`count(*)::int` }).from(knowledgeBases).where(eq(knowledgeBases.status, 'ACTIVE'));
  const [ragAgg] = await db.select({ recent: sql<number>`count(*)::int` }).from(ragRequests).where(gte(ragRequests.createdAt, dayAgo));

  const embedder = getEmbeddingProvider();
  const vector = getVectorStore();
  const storage = getFileStorage();
  const [storageHealth, embeddingHealth, vectorHealth] = await Promise.all([storage.health(), embedder.health(), vector.health()]);

  const cfg = embeddingConfig();
  return {
    counts: {
      totalFiles: fileAgg?.total ?? 0,
      documentsProcessed: fileAgg?.ready ?? 0,
      failedProcessing: fileAgg?.failed ?? 0,
      processing: fileAgg?.processing ?? 0,
      totalChunks: chunkAgg?.chunks ?? 0,
      knowledgeBases: kbAgg?.kbs ?? 0,
      storedBytes: Number(fileAgg?.bytes ?? 0),
      ragRequests24h: ragAgg?.recent ?? 0,
    },
    embedding: { provider: cfg.provider, model: embedder.model, dimensions: embedder.dimensions },
    vectorStore: vector.name,
    health: {
      fileStorage: storageHealth,
      embeddingProvider: embeddingHealth,
      vectorStore: vectorHealth,
    },
  };
}

/** Metadata-only document search for support (never content). */
export async function adminDocumentSearch(query: string | undefined, limit = 50) {
  const q = query?.trim();
  const where = q
    ? and(ne(files.status, 'DELETED'), or(ilike(files.displayName, `%${q}%`), ilike(users.email, `%${q}%`)))
    : ne(files.status, 'DELETED');
  return getDb()
    .select({
      id: files.id,
      displayName: files.displayName,
      status: files.status,
      sizeBytes: files.sizeBytes,
      extension: files.extension,
      failureReason: files.failureReason,
      createdAt: files.createdAt,
      ownerEmail: users.email,
      organizationName: organizations.displayName,
    })
    .from(files)
    .leftJoin(users, eq(users.id, files.ownerUserId))
    .leftJoin(organizations, eq(organizations.id, files.organizationId))
    .where(where)
    .orderBy(desc(files.createdAt))
    .limit(Math.min(limit, 200));
}
