import { randomBytes, createHash } from 'node:crypto';
import { and, desc, eq } from 'drizzle-orm';
import { getDb } from '@/server/db';
import { organizationInvitations, organizationMembers, organizations, users } from '@/server/db/schema';
import type { OrgRole } from '@/server/auth/permissions';
import { logSecurityEvent } from '@/server/auth/events';
import { badRequest, conflict, forbidden, notFound } from '@/lib/errors';

/**
 * Organization invitations — cryptographically-random tokens stored HASHED,
 * expiring, single-use, revocable, and tied to (org + email). Acceptance is
 * atomic to prevent double-accept races. Tokens are never exposed in listings.
 */

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

function hash(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
function normEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** Create (or refresh) a pending invitation. Returns the RAW token once. */
export async function createInvitation(
  org: { id: string; displayName: string },
  actor: { id: string },
  input: { email: string; role: OrgRole },
): Promise<{ token: string; email: string }> {
  const email = normEmail(input.email);
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw badRequest('Invalid email');
  const db = getDb();

  // Already a member?
  const [existingMember] = await db
    .select({ id: organizationMembers.id })
    .from(organizationMembers)
    .innerJoin(users, eq(users.id, organizationMembers.userId))
    .where(and(eq(organizationMembers.organizationId, org.id), eq(users.email, email)))
    .limit(1);
  if (existingMember) throw conflict('That person is already a member');

  const token = randomBytes(32).toString('hex');
  // Replace any prior PENDING invite for this (org,email) — dedupe + token rotation.
  await db
    .update(organizationInvitations)
    .set({ status: 'REVOKED' })
    .where(and(eq(organizationInvitations.organizationId, org.id), eq(organizationInvitations.email, email), eq(organizationInvitations.status, 'PENDING')));

  await db.insert(organizationInvitations).values({
    organizationId: org.id,
    email,
    role: input.role,
    tokenHash: hash(token),
    invitedBy: actor.id,
    expiresAt: new Date(Date.now() + INVITE_TTL_MS),
  });

  await logSecurityEvent({ event: 'org.member.invited', actorUserId: actor.id, organizationId: org.id, metadata: { email, role: input.role } });
  return { token, email };
}

export async function listInvitations(orgId: string) {
  return getDb()
    .select({
      id: organizationInvitations.id,
      email: organizationInvitations.email,
      role: organizationInvitations.role,
      status: organizationInvitations.status,
      expiresAt: organizationInvitations.expiresAt,
      createdAt: organizationInvitations.createdAt,
    })
    .from(organizationInvitations)
    .where(eq(organizationInvitations.organizationId, orgId))
    .orderBy(desc(organizationInvitations.createdAt));
}

export async function revokeInvitation(orgId: string, invitationId: string, actorUserId: string) {
  const rows = await getDb()
    .update(organizationInvitations)
    .set({ status: 'REVOKED' })
    .where(and(eq(organizationInvitations.id, invitationId), eq(organizationInvitations.organizationId, orgId), eq(organizationInvitations.status, 'PENDING')))
    .returning({ id: organizationInvitations.id });
  if (!rows.length) throw notFound('No pending invitation to revoke');
  await logSecurityEvent({ event: 'org.invitation.revoked', actorUserId, organizationId: orgId, metadata: { invitationId } });
  return { ok: true };
}

/**
 * Accept an invitation by raw token, for the authenticated user. Atomic: the
 * invite is flipped PENDING→ACCEPTED with a guarded UPDATE, then membership is
 * created — so two concurrent accepts can't both create a membership.
 */
export async function acceptInvitation(token: string, user: { id: string; email: string }) {
  const db = getDb();
  const th = hash(token);

  return db.transaction(async (tx) => {
    const [invite] = await tx
      .select()
      .from(organizationInvitations)
      .where(eq(organizationInvitations.tokenHash, th))
      .limit(1);

    if (!invite || invite.status !== 'PENDING') throw badRequest('Invitation is not valid');
    if (invite.expiresAt.getTime() < Date.now()) {
      await tx.update(organizationInvitations).set({ status: 'EXPIRED' }).where(eq(organizationInvitations.id, invite.id));
      throw badRequest('Invitation has expired');
    }
    // Bind to the invited email (existing users only accept their own invite).
    if (invite.email.toLowerCase() !== user.email.toLowerCase()) {
      throw forbidden('This invitation was sent to a different email');
    }

    // Atomic single-accept guard.
    const flipped = await tx
      .update(organizationInvitations)
      .set({ status: 'ACCEPTED', acceptedBy: user.id, acceptedAt: new Date() })
      .where(and(eq(organizationInvitations.id, invite.id), eq(organizationInvitations.status, 'PENDING')))
      .returning({ id: organizationInvitations.id });
    if (!flipped.length) throw conflict('Invitation was already used');

    // Idempotent membership (unique on org+user).
    await tx
      .insert(organizationMembers)
      .values({ organizationId: invite.organizationId, userId: user.id, role: invite.role })
      .onConflictDoNothing({ target: [organizationMembers.organizationId, organizationMembers.userId] });

    const [org] = await tx.select({ slug: organizations.slug }).from(organizations).where(eq(organizations.id, invite.organizationId)).limit(1);
    await logSecurityEvent({ event: 'org.member.joined', userId: user.id, actorUserId: user.id, organizationId: invite.organizationId });
    return { ok: true, slug: org?.slug };
  });
}
