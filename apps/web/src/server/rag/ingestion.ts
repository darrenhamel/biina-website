import { eq } from 'drizzle-orm';
import { getDb } from '@/server/db';
import { files, documentChunks } from '@/server/db/schema';
import { logger } from '@/lib/logger';
import { getFileStorage } from './storage';
import { detectType, extractDocument, UnsupportedFileError } from './processor';
import { chunkPages } from './chunking';
import { getEmbeddingProvider } from './embeddings';
import { getVectorStore } from './vector-store';
import { chunkConfig } from './config';

/**
 * Ingestion pipeline — the ONE clean job boundary for turning an uploaded file
 * into searchable chunks:
 *
 *   file → extract → chunk → embed → store vectors → READY
 *
 * IDEMPOTENT + retry-safe: it deletes any prior chunks for the file first, so a
 * retry (or an embedding-model change) never produces duplicates. It NEVER throws
 * — the file's status always reflects the outcome (READY / FAILED / UNSUPPORTED),
 * so a partially processed file is never left ambiguously READY.
 */
export async function ingestFile(fileId: string): Promise<void> {
  const db = getDb();
  const started = Date.now();
  const [file] = await db.select().from(files).where(eq(files.id, fileId)).limit(1);
  if (!file || file.status === 'DELETED') return;

  const fail = async (reason: string, status: 'FAILED' | 'UNSUPPORTED' = 'FAILED') => {
    await db.update(files).set({ status, failureReason: reason.slice(0, 500), updatedAt: new Date(), chunkCount: 0 }).where(eq(files.id, fileId));
    logger.warn('rag.ingest.failed', { fileId, status, reason });
  };

  try {
    await db.update(files).set({ status: 'PROCESSING', failureReason: null, updatedAt: new Date() }).where(eq(files.id, fileId));
    // Clean slate — retry/reprocess never duplicates chunks.
    await db.delete(documentChunks).where(eq(documentChunks.documentId, fileId));

    const type = detectType(file.extension, file.mimeType);
    if (!type) return void (await fail('Unsupported file type', 'UNSUPPORTED'));

    const bytes = await getFileStorage().get(file.storageKey);
    const extracted = await extractDocument(bytes, type);

    if (extracted.likelyScanned) {
      // Detected but not auto-OCR'd (extension point). Tell the user clearly.
      return void (await fail('This document appears to contain scanned images and may require OCR.', 'UNSUPPORTED'));
    }

    const { chunkSize, chunkOverlap } = chunkConfig();
    const chunks = chunkPages(extracted.pages, { chunkSize, chunkOverlap });
    if (chunks.length === 0) return void (await fail('No extractable text found in the document.', 'UNSUPPORTED'));

    // Insert chunks (PENDING) with denormalized trusted scope for isolation.
    const inserted = await db
      .insert(documentChunks)
      .values(
        chunks.map((c) => ({
          documentId: file.id,
          knowledgeBaseId: file.knowledgeBaseId!,
          organizationId: file.organizationId,
          ownerUserId: file.ownerUserId,
          chunkIndex: c.chunkIndex,
          content: c.content,
          pageNumber: c.pageNumber,
          sectionTitle: c.sectionTitle,
          tokenCount: c.tokenCount,
          embeddingStatus: 'PENDING' as const,
        })),
      )
      .returning({ id: documentChunks.id });

    // Embed + store vectors.
    const embedder = getEmbeddingProvider();
    const vectors = await embedder.embed(chunks.map((c) => c.content));
    if (vectors.length !== inserted.length) return void (await fail('Embedding produced a mismatched result count.'));
    await getVectorStore().upsert(inserted.map((r) => r.id), vectors, embedder.model, embedder.dimensions);

    await db
      .update(files)
      .set({ status: 'READY', chunkCount: chunks.length, pageCount: extracted.pageCount, failureReason: null, updatedAt: new Date() })
      .where(eq(files.id, fileId));
    logger.info('rag.ingest.ready', { fileId, chunks: chunks.length, ms: Date.now() - started });
  } catch (err) {
    if (err instanceof UnsupportedFileError) return void (await fail(err.message, 'UNSUPPORTED'));
    await fail(String((err as Error)?.message ?? err));
  }
}
