import { and, eq, sql } from 'drizzle-orm';
import { getDb } from '@/server/db';
import { memories, memoryCandidates } from '@/server/db/schema';
import { getEmbeddingProvider } from '@/server/rag/embeddings';

/**
 * Admin memory HEALTH — operational metadata only. Platform admins never see
 * private memory CONTENT here (item 51): only counts, health, and retention state.
 * Org managers may inspect their own org's memory content via the org memory API.
 */

export async function memoryHealth(): Promise<{
  totalActive: number;
  byType: Array<{ type: string; count: number }>;
  pendingCandidates: number;
  expired: number;
  personal: number;
  organization: number;
  embedding: { ok: boolean; model: string; detail?: string };
}> {
  const db = getDb();
  const [active, byTypeRows, pending, expired, personal, org, embedHealth] = await Promise.all([
    db.select({ n: sql<number>`count(*)::int` }).from(memories).where(eq(memories.status, 'ACTIVE')),
    db.select({ type: memories.memoryType, count: sql<number>`count(*)::int` }).from(memories).where(eq(memories.status, 'ACTIVE')).groupBy(memories.memoryType),
    db.select({ n: sql<number>`count(*)::int` }).from(memoryCandidates).where(eq(memoryCandidates.status, 'PENDING')),
    db.select({ n: sql<number>`count(*)::int` }).from(memories).where(eq(memories.status, 'EXPIRED')),
    db.select({ n: sql<number>`count(*)::int` }).from(memories).where(and(eq(memories.status, 'ACTIVE'), eq(memories.ownerType, 'PERSONAL'))),
    db.select({ n: sql<number>`count(*)::int` }).from(memories).where(and(eq(memories.status, 'ACTIVE'), eq(memories.ownerType, 'ORGANIZATION'))),
    getEmbeddingProvider().health().catch(() => ({ ok: false, detail: 'unavailable' })),
  ]);
  const provider = getEmbeddingProvider();
  return {
    totalActive: active[0]?.n ?? 0,
    byType: byTypeRows.map((r) => ({ type: r.type, count: r.count })),
    pendingCandidates: pending[0]?.n ?? 0,
    expired: expired[0]?.n ?? 0,
    personal: personal[0]?.n ?? 0,
    organization: org[0]?.n ?? 0,
    embedding: { ok: embedHealth.ok, model: provider.model, detail: (embedHealth as { detail?: string }).detail },
  };
}
