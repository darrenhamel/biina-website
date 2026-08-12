import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import { getDb } from '@/server/db';
import { documentChunks, files } from '@/server/db/schema';
import { cosineSimilarity } from './embeddings';
import { vectorStoreKind } from './config';

/**
 * Provider-independent vector store. The rest of RAG uses this interface, never a
 * specific vector DB, so pgvector can be swapped for Qdrant/Pinecone/Weaviate
 * later without touching ingestion or chat (see docs/VECTOR_STORAGE.md).
 *
 * DEFAULT: a PORTABLE store that keeps embeddings in `document_chunks.embedding`
 * (JSON float array) and ranks by cosine — no pgvector extension required, so it
 * runs anywhere. A pgvector deployment adds a `vector` column + ANN index and a
 * PgVectorStore adapter; the interface is identical.
 *
 * ISOLATION (critical): `similaritySearch` filters by the trusted tenant scope IN
 * THE QUERY — the candidate set only ever contains chunks the caller may access.
 * Similarity is computed over that already-authorized set, never globally.
 */

export interface VectorFilter {
  knowledgeBaseIds: string[];
  /** Exactly one scope is set. org → org chunks only; user → that user's personal chunks. */
  organizationId: string | null;
  ownerUserId: string | null;
  documentId?: string;
}

export interface SearchResult {
  chunkId: string;
  documentId: string;
  documentName: string;
  knowledgeBaseId: string;
  chunkIndex: number;
  content: string;
  pageNumber: number | null;
  sectionTitle: string | null;
  score: number;
}

export interface VectorStore {
  readonly name: string;
  upsert(chunkIds: string[], embeddings: number[][], model: string, dim: number): Promise<void>;
  deleteByDocument(documentId: string): Promise<void>;
  similaritySearch(query: number[], filter: VectorFilter, topK: number, minScore: number): Promise<SearchResult[]>;
  health(): Promise<{ ok: boolean; detail?: string }>;
}

/** Build the tenant-isolation WHERE clause. This IS the authorization boundary. */
function scopeCondition(filter: VectorFilter) {
  if (filter.knowledgeBaseIds.length === 0) return sql`false`;
  const conds = [
    inArray(documentChunks.knowledgeBaseId, filter.knowledgeBaseIds),
    eq(documentChunks.embeddingStatus, 'EMBEDDED'),
  ];
  if (filter.organizationId) {
    conds.push(eq(documentChunks.organizationId, filter.organizationId));
  } else if (filter.ownerUserId) {
    // Personal scope: the user's own chunks that are NOT org-owned.
    conds.push(eq(documentChunks.ownerUserId, filter.ownerUserId));
    conds.push(isNull(documentChunks.organizationId));
  } else {
    return sql`false`; // no trusted scope → nothing
  }
  if (filter.documentId) conds.push(eq(documentChunks.documentId, filter.documentId));
  return and(...conds);
}

class PortableVectorStore implements VectorStore {
  readonly name = 'portable';

  async upsert(chunkIds: string[], embeddings: number[][], model: string, dim: number): Promise<void> {
    const db = getDb();
    for (let i = 0; i < chunkIds.length; i++) {
      await db
        .update(documentChunks)
        .set({ embedding: embeddings[i], embeddingModel: model, embeddingDim: dim, embeddingStatus: 'EMBEDDED' })
        .where(eq(documentChunks.id, chunkIds[i]));
    }
  }

  async deleteByDocument(documentId: string): Promise<void> {
    // Chunks are removed with the file (cascade); this also clears any strays.
    await getDb().delete(documentChunks).where(eq(documentChunks.documentId, documentId));
  }

  async similaritySearch(query: number[], filter: VectorFilter, topK: number, minScore: number): Promise<SearchResult[]> {
    const db = getDb();
    // Authorized candidate set only — isolation is enforced here, not after ranking.
    const rows = await db
      .select({
        chunkId: documentChunks.id,
        documentId: documentChunks.documentId,
        documentName: files.displayName,
        knowledgeBaseId: documentChunks.knowledgeBaseId,
        chunkIndex: documentChunks.chunkIndex,
        content: documentChunks.content,
        pageNumber: documentChunks.pageNumber,
        sectionTitle: documentChunks.sectionTitle,
        embedding: documentChunks.embedding,
      })
      .from(documentChunks)
      .innerJoin(files, eq(files.id, documentChunks.documentId))
      .where(scopeCondition(filter));

    const scored = rows
      .map((r) => ({
        chunkId: r.chunkId,
        documentId: r.documentId,
        documentName: r.documentName,
        knowledgeBaseId: r.knowledgeBaseId,
        chunkIndex: r.chunkIndex,
        content: r.content,
        pageNumber: r.pageNumber,
        sectionTitle: r.sectionTitle,
        score: r.embedding ? cosineSimilarity(query, r.embedding) : 0,
      }))
      .filter((r) => r.score >= minScore)
      .sort((a, b) => b.score - a.score)
      .slice(0, topK);
    return scored;
  }

  async health(): Promise<{ ok: boolean; detail?: string }> {
    try {
      await getDb().select({ n: sql<number>`count(*)::int` }).from(documentChunks).limit(1);
      return { ok: true, detail: 'portable (jsonb embeddings)' };
    } catch (e) {
      return { ok: false, detail: String(e) };
    }
  }
}

let cached: VectorStore | null = null;
export function getVectorStore(): VectorStore {
  if (cached) return cached;
  switch (vectorStoreKind()) {
    // 'pgvector' adapter ships when the extension is provisioned (see docs).
    case 'portable':
    default:
      cached = new PortableVectorStore();
  }
  return cached;
}
