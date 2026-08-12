import { and, eq, sql } from 'drizzle-orm';
import { getDb } from '@/server/db';
import { organizationMembers, users, profiles } from '@/server/db/schema';
import type { OrgRole } from '@/server/auth/permissions';
import { canRemoveMember, canChangeMemberRoles } from '@/server/auth/permissions';
import { logSecurityEvent } from '@/server/auth/events';
import { conflict, forbidden, notFound } from '@/lib/errors';

/**
 * Organization member management with OWNER-count protection: an organization
 * must always keep at least one OWNER, so the last owner can neither be removed,
 * demoted, nor allowed to leave.
 */

export async function listMembers(orgId: string) {
  return getDb()
    .select({
      userId: organizationMembers.userId,
      role: organizationMembers.role,
      joinedAt: organizationMembers.joinedAt,
      email: users.email,
      displayName: profiles.displayName,
    })
    .from(organizationMembers)
    .innerJoin(users, eq(users.id, organizationMembers.userId))
    .leftJoin(profiles, eq(profiles.userId, organizationMembers.userId))
    .where(eq(organizationMembers.organizationId, orgId))
    .orderBy(organizationMembers.joinedAt);
}

async function ownerCount(orgId: string): Promise<number> {
  const [row] = await getDb()
    .select({ n: sql<number>`count(*)::int` })
    .from(organizationMembers)
    .where(and(eq(organizationMembers.organizationId, orgId), eq(organizationMembers.role, 'OWNER')));
  return row?.n ?? 0;
}

async function getMemberRole(orgId: string, userId: string): Promise<OrgRole | null> {
  const [m] = await getDb()
    .select({ role: organizationMembers.role })
    .from(organizationMembers)
    .where(and(eq(organizationMembers.organizationId, orgId), eq(organizationMembers.userId, userId)))
    .limit(1);
  return m?.role ?? null;
}

export async function removeMember(orgId: string, actor: { id: string; role: OrgRole }, targetUserId: string) {
  const targetRole = await getMemberRole(orgId, targetUserId);
  if (!targetRole) throw notFound('Member not found');
  if (!canRemoveMember(actor.role, targetRole)) throw forbidden('Not allowed to remove this member');
  if (targetRole === 'OWNER' && (await ownerCount(orgId)) <= 1) {
    throw conflict('Cannot remove the only owner');
  }
  await getDb()
    .delete(organizationMembers)
    .where(and(eq(organizationMembers.organizationId, orgId), eq(organizationMembers.userId, targetUserId)));
  await logSecurityEvent({ event: 'org.member.removed', userId: targetUserId, actorUserId: actor.id, organizationId: orgId, metadata: { role: targetRole } });
  return { ok: true };
}

export async function changeMemberRole(orgId: string, actor: { id: string; role: OrgRole }, targetUserId: string, newRole: OrgRole) {
  if (!canChangeMemberRoles(actor.role)) throw forbidden('Only an owner can change roles');
  const targetRole = await getMemberRole(orgId, targetUserId);
  if (!targetRole) throw notFound('Member not found');
  // Demoting the last owner would leave the org ownerless.
  if (targetRole === 'OWNER' && newRole !== 'OWNER' && (await ownerCount(orgId)) <= 1) {
    throw conflict('Cannot demote the only owner');
  }
  await getDb()
    .update(organizationMembers)
    .set({ role: newRole, updatedAt: new Date() })
    .where(and(eq(organizationMembers.organizationId, orgId), eq(organizationMembers.userId, targetUserId)));
  await logSecurityEvent({ event: 'org.member.role_changed', userId: targetUserId, actorUserId: actor.id, organizationId: orgId, metadata: { from: targetRole, to: newRole } });
  return { ok: true };
}

export async function leaveOrganization(orgId: string, user: { id: string; role: OrgRole }) {
  if (user.role === 'OWNER' && (await ownerCount(orgId)) <= 1) {
    throw conflict('Transfer ownership before leaving — you are the only owner');
  }
  await getDb()
    .delete(organizationMembers)
    .where(and(eq(organizationMembers.organizationId, orgId), eq(organizationMembers.userId, user.id)));
  await logSecurityEvent({ event: 'org.member.left', userId: user.id, actorUserId: user.id, organizationId: orgId });
  return { ok: true };
}
