import { and, eq, isNull, or, gt, sql } from 'drizzle-orm';
import { getDb } from '@/server/db';
import { memories } from '@/server/db/schema';
import type { Memory } from '@/server/db/schema';
import { getEmbeddingProvider, cosineSimilarity } from '@/server/rag/embeddings';

/**
 * MemoryRetrievalService — finds the FEW relevant, authorized, non-expired memories
 * for a request; it never dumps all memory into a prompt. Authorization + status +
 * expiry are enforced in the SQL WHERE (the candidate set is already safe); ranking
 * then combines relevance, scope match, explicit-vs-inferred, importance, confidence,
 * and recency. All identities are server-trusted.
 */

export interface RetrievalInput {
  userId: string;
  organizationId: string | null;
  persona?: string | null;
  projectId?: string | null;
  workflowId?: string | null;
  query: string;
  maxResults?: number;
  minRelevance?: number;
}

export interface RetrievedMemory {
  id: string;
  content: string;
  memoryType: Memory['memoryType'];
  scope: Memory['scope'];
  sourceType: Memory['sourceType'];
  confidence: number;
  relevance: number;
  rank: number;
}

/** Build the authorization + validity WHERE. This IS the isolation boundary. */
function candidateWhere(input: RetrievalInput) {
  const notExpired = or(isNull(memories.expiresAt), gt(memories.expiresAt, new Date()));
  if (input.organizationId) {
    // Org context: the user's PERSONAL memories PLUS this org's ORGANIZATION memories.
    return and(
      eq(memories.status, 'ACTIVE'),
      notExpired,
      or(
        and(eq(memories.ownerType, 'PERSONAL'), eq(memories.ownerUserId, input.userId), isNull(memories.organizationId)),
        and(eq(memories.ownerType, 'ORGANIZATION'), eq(memories.organizationId, input.organizationId)),
      ),
    );
  }
  // Personal context: ONLY this user's personal memories. No org memory leaks in.
  return and(eq(memories.status, 'ACTIVE'), notExpired, eq(memories.ownerType, 'PERSONAL'), eq(memories.ownerUserId, input.userId), isNull(memories.organizationId));
}

/** Scope filter applied in code: GLOBAL always; scoped only when the ref matches. */
function scopeAllowed(m: Memory, input: RetrievalInput): boolean {
  switch (m.scope) {
    case 'GLOBAL':
    case 'ORGANIZATION':
      return true;
    case 'PERSONA':
      return !m.scopeRef || m.scopeRef === (input.persona ?? '');
    case 'PROJECT':
      return Boolean(input.projectId) && m.scopeRef === input.projectId;
    case 'WORKFLOW':
      return Boolean(input.workflowId) && m.scopeRef === input.workflowId;
    default:
      return false;
  }
}

export async function retrieveMemories(input: RetrievalInput): Promise<RetrievedMemory[]> {
  const maxResults = Math.min(input.maxResults ?? 6, 12);
  const minRelevance = input.minRelevance ?? 0.15;

  const rows = await getDb().select().from(memories).where(candidateWhere(input));
  if (rows.length === 0) return [];

  const [q] = await getEmbeddingProvider().embed([input.query]);

  const scored = rows
    .filter((m) => scopeAllowed(m, input))
    .map((m) => {
      const relevance = m.embedding ? cosineSimilarity(q, m.embedding) : 0;
      // Composite rank: relevance dominates, nudged by scope/explicit/importance/confidence/recency.
      const explicit = m.sourceType === 'USER_EXPLICIT' || m.sourceType === 'ADMIN_DEFINED' || m.sourceType === 'ORGANIZATION_DEFINED' ? 0.1 : 0;
      const scopeBonus = m.scope !== 'GLOBAL' ? 0.05 : 0;
      const importance = (m.importance / 100) * 0.1;
      const confidence = m.confidence * 0.1;
      const ageDays = (Date.now() - new Date(m.updatedAt).getTime()) / 864e5;
      const recency = Math.max(0, 0.05 - ageDays / 3650); // small, decays over ~10y
      const rank = relevance + explicit + scopeBonus + importance + confidence + recency;
      return { m, relevance, rank };
    })
    .filter((x) => x.relevance >= minRelevance)
    .sort((a, b) => b.rank - a.rank);

  // Dedup by normalized content, then take the budgeted top-N.
  const seen = new Set<string>();
  const out: RetrievedMemory[] = [];
  for (const { m, relevance, rank } of scored) {
    const key = m.content.trim().toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ id: m.id, content: m.content, memoryType: m.memoryType, scope: m.scope, sourceType: m.sourceType, confidence: m.confidence, relevance, rank });
    if (out.length >= maxResults) break;
  }
  return out;
}

/** Mark expired memories (background/expiration job reuses this). */
export async function markExpiredMemories(): Promise<number> {
  const rows = await getDb()
    .update(memories)
    .set({ status: 'EXPIRED', updatedAt: new Date() })
    .where(and(eq(memories.status, 'ACTIVE'), sql`${memories.expiresAt} is not null`, sql`${memories.expiresAt} < now()`))
    .returning({ id: memories.id });
  return rows.length;
}
