import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import { getDb } from '@/server/db';
import { memories, memoryRevisions, memoryUsage } from '@/server/db/schema';
import type { Memory, Plan } from '@/server/db/schema';
import { resolveOrgContextById } from '@/server/org/organizations';
import { isOrgManager } from '@/server/auth/permissions';
import { logSecurityEvent } from '@/server/auth/events';
import { badRequest, forbidden, notFound, conflict } from '@/lib/errors';
import { getEmbeddingProvider, cosineSimilarity } from '@/server/rag/embeddings';
import { classifySensitivity, isStorableContent, type Sensitivity } from './sensitivity';

/**
 * Memory persistence + tenant-isolated access. Personal and organization memory
 * are DISTINCT security domains: a personal memory belongs to its owner alone; an
 * organization memory belongs to the org and is manageable only by a verified
 * manager in that org's active workspace. Ownership is ALWAYS derived server-side
 * — the browser can never set `ownerUserId`/`organizationId` for someone else.
 */

export interface MemoryAccess {
  memory: Memory;
  canManage: boolean;
}

export async function resolveMemoryAccess(userId: string, memoryId: string, activeOrganizationId: string | null): Promise<MemoryAccess | null> {
  const [m] = await getDb().select().from(memories).where(eq(memories.id, memoryId)).limit(1);
  if (!m || m.status === 'DELETED') return null;
  if (m.ownerType === 'PERSONAL') {
    if (m.ownerUserId !== userId) return null; // never another user's personal memory
    return { memory: m, canManage: true };
  }
  if (!m.organizationId || m.organizationId !== activeOrganizationId) return null; // wrong tenant
  const ctx = await resolveOrgContextById(userId, m.organizationId);
  if (!ctx) return null; // not a member
  return { memory: m, canManage: isOrgManager(ctx.role) };
}

async function embed(text: string): Promise<{ embedding: number[]; model: string; dim: number }> {
  const p = getEmbeddingProvider();
  const [embedding] = await p.embed([text]);
  return { embedding, model: p.model, dim: p.dimensions };
}

/** Count ACTIVE memories for a scope (quota). */
async function activeCount(scope: { ownerUserId: string; organizationId: string | null }): Promise<number> {
  const where = scope.organizationId
    ? and(eq(memories.organizationId, scope.organizationId), eq(memories.ownerType, 'ORGANIZATION'), eq(memories.status, 'ACTIVE'))
    : and(eq(memories.ownerUserId, scope.ownerUserId), eq(memories.ownerType, 'PERSONAL'), eq(memories.status, 'ACTIVE'));
  const [r] = await getDb().select({ n: sql<number>`count(*)::int` }).from(memories).where(where);
  return r?.n ?? 0;
}

export interface CreateMemoryInput {
  ownerType: 'PERSONAL' | 'ORGANIZATION';
  ownerUserId: string | null;
  organizationId: string | null;
  createdByUserId: string;
  memoryType: Memory['memoryType'];
  content: string;
  sourceType: Memory['sourceType'];
  sourceId?: string | null;
  scope?: Memory['scope'];
  scopeRef?: string | null;
  importance?: number;
  confidence?: number;
  expiresAt?: Date | null;
  /** Explicit consent captured for SENSITIVE/RESTRICTED content. */
  consented?: boolean;
  plan?: Plan;
}

/** Create a memory (embeds it, enforces storability + sensitivity consent + quota + dedup). */
export async function createMemory(input: CreateMemoryInput): Promise<Memory> {
  const content = input.content.trim();
  const storable = isStorableContent(content);
  if (!storable.ok) throw badRequest(`This cannot be stored as memory (${storable.reason}).`);

  const sensitivity: Sensitivity = classifySensitivity(content);
  // Sensitive/restricted content requires explicit consent (never silent).
  if (sensitivity !== 'NORMAL' && !input.consented) throw badRequest('Sensitive information needs explicit confirmation before it is remembered.', { sensitivity });

  // Quota (inform; never silently delete useful memories).
  if (input.plan?.maxMemories != null) {
    const n = await activeCount({ ownerUserId: input.ownerUserId ?? '', organizationId: input.organizationId });
    if (n >= input.plan.maxMemories) throw conflict('You have reached your memory limit. Remove some memories or upgrade your plan.', { limit: input.plan.maxMemories });
  }

  const { embedding, model, dim } = await embed(content);

  // Deduplicate near-identical memories of the same owner + type.
  const dup = await findDuplicate({ ownerUserId: input.ownerUserId, organizationId: input.organizationId, memoryType: input.memoryType, embedding });
  if (dup) return dup;

  const [row] = await getDb()
    .insert(memories)
    .values({
      ownerType: input.ownerType,
      ownerUserId: input.ownerType === 'PERSONAL' ? input.ownerUserId : null,
      organizationId: input.ownerType === 'ORGANIZATION' ? input.organizationId : null,
      memoryType: input.memoryType,
      content,
      sourceType: input.sourceType,
      sourceId: input.sourceId ?? null,
      scope: input.scope ?? 'GLOBAL',
      scopeRef: input.scopeRef ?? null,
      sensitivity,
      importance: Math.max(0, Math.min(100, input.importance ?? 50)),
      confidence: Math.max(0, Math.min(1, input.confidence ?? 1)),
      status: 'ACTIVE',
      embedding,
      embeddingModel: model,
      embeddingDim: dim,
      expiresAt: input.expiresAt ?? null,
      consentedAt: sensitivity !== 'NORMAL' && input.consented ? new Date() : null,
      createdByUserId: input.createdByUserId,
    })
    .returning();

  await getDb().insert(memoryRevisions).values({ memoryId: row.id, version: 1, content, changeType: 'created', actorUserId: input.createdByUserId });
  await logSecurityEvent({ event: 'memory.created', userId: input.createdByUserId, actorUserId: input.createdByUserId, organizationId: input.organizationId, metadata: { memoryId: row.id, type: input.memoryType, source: input.sourceType, sensitivity } });
  return row;
}

async function findDuplicate(input: { ownerUserId: string | null; organizationId: string | null; memoryType: Memory['memoryType']; embedding: number[] }): Promise<Memory | null> {
  const where = input.organizationId
    ? and(eq(memories.organizationId, input.organizationId), eq(memories.status, 'ACTIVE'), eq(memories.memoryType, input.memoryType))
    : and(eq(memories.ownerUserId, input.ownerUserId ?? ''), isNull(memories.organizationId), eq(memories.status, 'ACTIVE'), eq(memories.memoryType, input.memoryType));
  const rows = await getDb().select().from(memories).where(where);
  for (const r of rows) if (r.embedding && cosineSimilarity(input.embedding, r.embedding) >= 0.95) return r;
  return null;
}

/** Edit a memory's content (re-embeds; records a revision). */
export async function editMemory(access: MemoryAccess, content: string, actorUserId: string): Promise<Memory> {
  if (!access.canManage) throw forbidden('You cannot edit this memory.');
  const clean = content.trim();
  const storable = isStorableContent(clean);
  if (!storable.ok) throw badRequest(`This cannot be stored as memory (${storable.reason}).`);
  const { embedding, model, dim } = await embed(clean);
  const nextVersion = (await getDb().select({ n: sql<number>`count(*)::int` }).from(memoryRevisions).where(eq(memoryRevisions.memoryId, access.memory.id)))[0]?.n ?? 1;
  const [row] = await getDb()
    .update(memories)
    .set({ content: clean, sensitivity: classifySensitivity(clean), embedding, embeddingModel: model, embeddingDim: dim, updatedAt: new Date() })
    .where(eq(memories.id, access.memory.id))
    .returning();
  await getDb().insert(memoryRevisions).values({ memoryId: access.memory.id, version: nextVersion + 1, content: clean, changeType: 'edited', actorUserId });
  await logSecurityEvent({ event: 'memory.edited', userId: actorUserId, actorUserId, organizationId: access.memory.organizationId, metadata: { memoryId: access.memory.id } });
  return row;
}

/** Supersede an old memory with a new one (contradiction handling). */
export async function supersede(oldMemoryId: string, newMemoryId: string, actorUserId: string): Promise<void> {
  await getDb().update(memories).set({ status: 'SUPERSEDED', supersededById: newMemoryId, updatedAt: new Date() }).where(eq(memories.id, oldMemoryId));
  await getDb().insert(memoryRevisions).values({ memoryId: oldMemoryId, version: 0, changeType: 'superseded', actorUserId });
  await logSecurityEvent({ event: 'memory.superseded', userId: actorUserId, actorUserId, metadata: { oldMemoryId, newMemoryId } });
}

/** Soft-delete (stops all future retrieval). Records a revision; content preserved for audit only briefly. */
export async function deleteMemory(access: MemoryAccess, actorUserId: string): Promise<void> {
  if (!access.canManage) throw forbidden('You cannot delete this memory.');
  await getDb().update(memories).set({ status: 'DELETED', deletedAt: new Date(), updatedAt: new Date() }).where(eq(memories.id, access.memory.id));
  await getDb().insert(memoryRevisions).values({ memoryId: access.memory.id, version: 0, changeType: 'deleted', actorUserId });
  await logSecurityEvent({ event: 'memory.deleted', userId: actorUserId, actorUserId, organizationId: access.memory.organizationId, metadata: { memoryId: access.memory.id } });
}

/** Clear ALL personal memory for a user (does not touch conversations/files/KBs). */
export async function clearPersonalMemory(userId: string): Promise<number> {
  const rows = await getDb()
    .update(memories)
    .set({ status: 'DELETED', deletedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(memories.ownerUserId, userId), eq(memories.ownerType, 'PERSONAL'), eq(memories.status, 'ACTIVE')))
    .returning({ id: memories.id });
  await logSecurityEvent({ event: 'memory.cleared', userId, actorUserId: userId, metadata: { count: rows.length } });
  return rows.length;
}

export async function listMemories(scope: { userId: string; organizationId: string | null }, filters: { search?: string; type?: Memory['memoryType'] } = {}): Promise<Memory[]> {
  const where = scope.organizationId
    ? and(eq(memories.organizationId, scope.organizationId), eq(memories.ownerType, 'ORGANIZATION'), eq(memories.status, 'ACTIVE'))
    : and(eq(memories.ownerUserId, scope.userId), eq(memories.ownerType, 'PERSONAL'), isNull(memories.organizationId), eq(memories.status, 'ACTIVE'));
  let rows = await getDb().select().from(memories).where(where).orderBy(desc(memories.updatedAt));
  if (filters.type) rows = rows.filter((r) => r.memoryType === filters.type);
  if (filters.search) {
    const q = filters.search.toLowerCase();
    rows = rows.filter((r) => r.content.toLowerCase().includes(q));
  }
  return rows;
}

export async function recordUsage(memoryIds: string[], requestId: string | null, userId: string): Promise<void> {
  if (!memoryIds.length) return;
  try {
    await getDb().insert(memoryUsage).values(memoryIds.map((memoryId) => ({ memoryId, requestId, userId })));
    await getDb().update(memories).set({ lastUsedAt: new Date() }).where(and(eq(memories.status, 'ACTIVE'), sql`${memories.id} = any(${memoryIds})`));
  } catch {
    /* usage logging is best-effort */
  }
}
