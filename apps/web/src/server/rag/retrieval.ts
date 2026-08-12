import { getDb } from '@/server/db';
import { ragRequests } from '@/server/db/schema';
import { resolveKbAccess } from './knowledge-bases';
import { getEmbeddingProvider } from './embeddings';
import { getVectorStore, type SearchResult } from './vector-store';
import { retrievalConfig } from './config';

/**
 * KnowledgeRetrievalService — the ONE trusted entry to search knowledge.
 *
 * ISOLATION (critical): every context value is server-trusted. Requested KBs are
 * verified against the caller's access AND the ACTIVE workspace scope, so an org
 * KB can't be searched from a personal chat and Org A can never retrieve Org B's
 * content — even at identical semantic similarity. The vector store then filters
 * again by scope in the query (defense in depth). The LLM never decides access.
 */

export interface RetrievalInput {
  query: string;
  userId: string;
  /** The ACTIVE workspace: an org id, or null for personal. Server-resolved. */
  organizationId: string | null;
  knowledgeBaseIds: string[];
  topK?: number;
  minScore?: number;
  conversationId?: string | null;
  requestId?: string | null;
}

export interface RetrievalOutput {
  results: SearchResult[];
  authorizedKnowledgeBaseIds: string[];
  retrievalMs: number;
}

/** Keep only KBs the caller may use IN THE ACTIVE SCOPE. */
async function authorizeKbs(userId: string, organizationId: string | null, kbIds: string[]): Promise<string[]> {
  const unique = Array.from(new Set(kbIds)).slice(0, 20);
  const authorized: string[] = [];
  for (const kbId of unique) {
    const acc = await resolveKbAccess(userId, kbId);
    if (!acc) continue;
    if (organizationId) {
      if (acc.kb.organizationId === organizationId) authorized.push(kbId); // org workspace → this org's KBs only
    } else if (acc.kb.organizationId === null && acc.kb.ownerUserId === userId) {
      authorized.push(kbId); // personal workspace → own personal KBs only
    }
  }
  return authorized;
}

export async function retrieveKnowledge(input: RetrievalInput): Promise<RetrievalOutput> {
  const cfg = retrievalConfig();
  const topK = Math.min(input.topK ?? cfg.topK, 20);
  const minScore = input.minScore ?? cfg.minScore;
  const started = Date.now();

  const authorizedKnowledgeBaseIds = await authorizeKbs(input.userId, input.organizationId, input.knowledgeBaseIds);
  if (authorizedKnowledgeBaseIds.length === 0) {
    return { results: [], authorizedKnowledgeBaseIds: [], retrievalMs: Date.now() - started };
  }

  const [queryVec] = await getEmbeddingProvider().embed([input.query]);
  const results = await getVectorStore().similaritySearch(
    queryVec,
    {
      knowledgeBaseIds: authorizedKnowledgeBaseIds,
      organizationId: input.organizationId,
      ownerUserId: input.organizationId ? null : input.userId,
    },
    topK,
    minScore,
  );
  const retrievalMs = Date.now() - started;

  // Debug/audit record — references + scores only, never duplicated content.
  try {
    await getDb().insert(ragRequests).values({
      requestId: input.requestId ?? null,
      userId: input.userId,
      organizationId: input.organizationId,
      conversationId: input.conversationId ?? null,
      knowledgeBaseIds: authorizedKnowledgeBaseIds,
      retrievedChunkIds: results.map((r) => r.chunkId),
      scores: results.map((r) => Math.round(r.score * 1000) / 1000),
      resultCount: results.length,
      retrievalMs,
    });
  } catch {
    /* audit is best-effort — never breaks retrieval */
  }

  return { results, authorizedKnowledgeBaseIds, retrievalMs };
}
