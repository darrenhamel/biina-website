import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import { getDb } from '@/server/db';
import { knowledgeBases, files } from '@/server/db/schema';
import type { KnowledgeBase } from '@/server/db/schema';
import { resolveOrgContextById } from '@/server/org/organizations';
import { isOrgManager } from '@/server/auth/permissions';
import { logSecurityEvent } from '@/server/auth/events';
import { badRequest, conflict, forbidden, notFound } from '@/lib/errors';

/**
 * Knowledge bases: owned by a user XOR an organization. Access reuses the ORG
 * role system (no new permission model): a personal KB is private to its owner;
 * an org KB is readable by any member and editable by org managers (OWNER/ADMIN).
 *
 * ISOLATION: `resolveKbAccess` verifies membership server-side and returns null
 * when the caller has no access — so a KB id from another tenant reveals nothing.
 */

export type KbScope = { userId: string } | { organizationId: string };

export interface KbAccess {
  kb: KnowledgeBase;
  canView: boolean;
  canEdit: boolean;
}

/** Resolve a KB the caller can access, with view/edit rights — or null. */
export async function resolveKbAccess(userId: string, kbId: string): Promise<KbAccess | null> {
  const [kb] = await getDb().select().from(knowledgeBases).where(eq(knowledgeBases.id, kbId)).limit(1);
  if (!kb) return null;

  if (kb.organizationId) {
    const ctx = await resolveOrgContextById(userId, kb.organizationId);
    if (!ctx) return null; // not a member → no access (no existence leak)
    return { kb, canView: true, canEdit: isOrgManager(ctx.role) };
  }
  // Personal KB — only the owner.
  if (kb.ownerUserId === userId) return { kb, canView: true, canEdit: true };
  return null;
}

/** All KBs the caller may use in a given workspace scope (personal or one org). */
export async function listAccessibleKnowledgeBases(scope: KbScope) {
  const db = getDb();
  const where =
    'organizationId' in scope
      ? eq(knowledgeBases.organizationId, scope.organizationId)
      : and(eq(knowledgeBases.ownerUserId, scope.userId), isNull(knowledgeBases.organizationId));
  const rows = await db
    .select({
      id: knowledgeBases.id,
      name: knowledgeBases.name,
      description: knowledgeBases.description,
      status: knowledgeBases.status,
      organizationId: knowledgeBases.organizationId,
      createdAt: knowledgeBases.createdAt,
      documentCount: sql<number>`(select count(*)::int from ${files} where ${files.knowledgeBaseId} = ${knowledgeBases.id} and ${files.status} <> 'DELETED')`,
    })
    .from(knowledgeBases)
    .where(and(where, eq(knowledgeBases.status, 'ACTIVE')))
    .orderBy(desc(knowledgeBases.createdAt));
  return rows;
}

async function countPersonalKbs(userId: string): Promise<number> {
  const [row] = await getDb()
    .select({ n: sql<number>`count(*)::int` })
    .from(knowledgeBases)
    .where(and(eq(knowledgeBases.ownerUserId, userId), isNull(knowledgeBases.organizationId), eq(knowledgeBases.status, 'ACTIVE')));
  return row?.n ?? 0;
}

export async function createKnowledgeBase(
  user: { id: string },
  input: { name: string; description?: string | null },
  scope: KbScope,
  limits: { maxKnowledgeBases?: number | null } = {},
): Promise<KnowledgeBase> {
  const name = input.name.trim();
  if (name.length < 1) throw badRequest('A name is required');

  if ('organizationId' in scope) {
    // Org KB: creator must be an org manager.
    const ctx = await resolveOrgContextById(user.id, scope.organizationId);
    if (!ctx) throw notFound('Not found');
    if (!isOrgManager(ctx.role)) throw forbidden('Only organization managers can create knowledge bases');
  } else if (limits.maxKnowledgeBases != null && (await countPersonalKbs(user.id)) >= limits.maxKnowledgeBases) {
    throw conflict('You have reached your knowledge base limit for your plan');
  }

  const [kb] = await getDb()
    .insert(knowledgeBases)
    .values({
      name,
      description: input.description?.trim() || null,
      ownerUserId: 'organizationId' in scope ? null : scope.userId,
      organizationId: 'organizationId' in scope ? scope.organizationId : null,
      createdByUserId: user.id,
    })
    .returning();
  await logSecurityEvent({
    event: 'kb.created',
    userId: user.id,
    actorUserId: user.id,
    organizationId: 'organizationId' in scope ? scope.organizationId : null,
    metadata: { kbId: kb.id, name },
  });
  return kb;
}

export async function renameKnowledgeBase(userId: string, kbId: string, patch: { name?: string; description?: string | null }) {
  const access = await resolveKbAccess(userId, kbId);
  if (!access) throw notFound('Not found');
  if (!access.canEdit) throw forbidden('You cannot edit this knowledge base');
  const set: Record<string, unknown> = { updatedAt: new Date() };
  if (patch.name !== undefined) set.name = patch.name.trim();
  if (patch.description !== undefined) set.description = patch.description?.trim() || null;
  await getDb().update(knowledgeBases).set(set).where(eq(knowledgeBases.id, kbId));
  return { ok: true };
}

export async function deleteKnowledgeBase(userId: string, kbId: string) {
  const access = await resolveKbAccess(userId, kbId);
  if (!access) throw notFound('Not found');
  if (!access.canEdit) throw forbidden('You cannot delete this knowledge base');
  const db = getDb();
  // Purge storage objects first (DB rows cascade on KB delete, storage does not).
  const { getFileStorage } = await import('./storage');
  const storage = getFileStorage();
  const objects = await db.select({ storageKey: files.storageKey }).from(files).where(eq(files.knowledgeBaseId, kbId));
  await Promise.all(objects.map((o) => storage.delete(o.storageKey).catch(() => {})));
  // Files + chunks cascade on KB delete (FK onDelete cascade).
  await db.delete(knowledgeBases).where(eq(knowledgeBases.id, kbId));
  await logSecurityEvent({
    event: 'kb.deleted',
    userId,
    actorUserId: userId,
    organizationId: access.kb.organizationId,
    metadata: { kbId },
  });
  return { ok: true };
}
