import { createHash, randomBytes } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { getDb } from '@/server/db';
import { scimConfigurations, organizationMembers, organizationGroups, organizationGroupMembers, users, profiles } from '@/server/db/schema';
import { AppError } from '@/lib/errors';
import { logSecurityEvent } from '@/server/auth/events';

/**
 * Provider-independent SCIM 2.0 provisioning (Users + Groups). A SCIM bearer token is
 * scoped to ONE organization; it can never read or mutate another tenant's users. The
 * token is stored HASHED and shown in full only once at creation. Deprovisioning stops
 * organization access; it never destroys a person's personal BIINA account or data.
 */

function hashToken(t: string): string {
  return createHash('sha256').update(t).digest('hex');
}

/** Create/rotate the org SCIM token. Returns the plaintext ONCE. */
export async function createScimToken(organizationId: string, actorUserId: string): Promise<{ token: string }> {
  const token = `scim_${randomBytes(30).toString('base64url')}`;
  const tokenHash = hashToken(token);
  const db = getDb();
  const [existing] = await db.select().from(scimConfigurations).where(eq(scimConfigurations.organizationId, organizationId)).limit(1);
  const values = { enabled: true, tokenHash, tokenPrefix: token.slice(0, 10), tokenLastFour: token.slice(-4), createdByUserId: actorUserId, updatedAt: new Date() };
  if (existing) await db.update(scimConfigurations).set(values).where(eq(scimConfigurations.organizationId, organizationId));
  else await db.insert(scimConfigurations).values({ organizationId, ...values });
  await logSecurityEvent({ event: 'scim.token_created', userId: actorUserId, organizationId });
  return { token };
}

/** Resolve the organization a SCIM bearer token authorizes (tenant scoping). */
export async function authenticateScim(token: string | null | undefined): Promise<string> {
  if (!token) throw new AppError(401, 'SCIM token required.', 'scim_no_token');
  const [cfg] = await getDb().select().from(scimConfigurations).where(eq(scimConfigurations.tokenHash, hashToken(token))).limit(1);
  if (!cfg || !cfg.enabled) throw new AppError(401, 'Invalid SCIM token.', 'scim_invalid');
  await getDb().update(scimConfigurations).set({ lastUsedAt: new Date() }).where(eq(scimConfigurations.organizationId, cfg.organizationId));
  return cfg.organizationId;
}

export interface ScimUserInput {
  userName: string; // email
  displayName?: string;
  externalId?: string;
  active?: boolean;
}

/** Provision (create or link) a user + org membership. Avoids duplicate accounts. */
export async function provisionUser(organizationId: string, input: ScimUserInput): Promise<{ userId: string; created: boolean; membershipId: string }> {
  const email = input.userName.trim().toLowerCase();
  if (!email.includes('@')) throw new AppError(400, 'Invalid userName (must be an email).', 'scim_bad_user');
  const db = getDb();
  let [user] = await db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1);
  let created = false;
  if (!user) {
    [user] = await db.insert(users).values({ email, passwordHash: 'scim:no-password', role: 'USER', plan: 'FREE', status: 'ACTIVE', emailVerified: true }).returning({ id: users.id });
    await db.insert(profiles).values({ userId: user.id, displayName: input.displayName ?? email });
    created = true;
  }
  const [existing] = await db.select().from(organizationMembers).where(and(eq(organizationMembers.organizationId, organizationId), eq(organizationMembers.userId, user.id))).limit(1);
  let membershipId: string;
  if (existing) {
    membershipId = existing.id;
    await db.update(organizationMembers).set({ managedByScim: true, scimExternalId: input.externalId ?? existing.scimExternalId, active: input.active !== false, updatedAt: new Date() }).where(eq(organizationMembers.id, existing.id));
  } else {
    const [m] = await db.insert(organizationMembers).values({ organizationId, userId: user.id, role: 'MEMBER', managedByScim: true, scimExternalId: input.externalId ?? null, active: input.active !== false }).returning();
    membershipId = m.id;
  }
  await logSecurityEvent({ event: 'scim.user_provisioned', organizationId, userId: user.id, metadata: { created } });
  return { userId: user.id, created, membershipId };
}

/** Deactivate a member. Org access stops; personal account + data are untouched. */
export async function deactivateUser(organizationId: string, externalIdOrEmail: string): Promise<{ deactivated: boolean }> {
  const db = getDb();
  // Match by SCIM externalId first, then by email within the org.
  let [member] = await db.select().from(organizationMembers).where(and(eq(organizationMembers.organizationId, organizationId), eq(organizationMembers.scimExternalId, externalIdOrEmail))).limit(1);
  if (!member && externalIdOrEmail.includes('@')) {
    const [u] = await db.select({ id: users.id }).from(users).where(eq(users.email, externalIdOrEmail.toLowerCase())).limit(1);
    if (u) [member] = await db.select().from(organizationMembers).where(and(eq(organizationMembers.organizationId, organizationId), eq(organizationMembers.userId, u.id))).limit(1);
  }
  if (!member) return { deactivated: false };
  await db.update(organizationMembers).set({ active: false, updatedAt: new Date() }).where(eq(organizationMembers.id, member.id));
  await logSecurityEvent({ event: 'scim.user_deactivated', organizationId, userId: member.userId });
  return { deactivated: true };
}

/** A member's ACTIVE org access (used by access checks). Inactive = no org access. */
export async function memberIsActive(organizationId: string, userId: string): Promise<boolean> {
  const [m] = await getDb().select({ active: organizationMembers.active }).from(organizationMembers).where(and(eq(organizationMembers.organizationId, organizationId), eq(organizationMembers.userId, userId))).limit(1);
  return m ? m.active : false;
}

// ---- Groups ----

export async function provisionGroup(organizationId: string, input: { displayName: string; externalId?: string }): Promise<{ groupId: string }> {
  const db = getDb();
  const [existing] = await db.select().from(organizationGroups).where(and(eq(organizationGroups.organizationId, organizationId), eq(organizationGroups.name, input.displayName))).limit(1);
  if (existing) return { groupId: existing.id };
  const [g] = await db.insert(organizationGroups).values({ organizationId, name: input.displayName, groupType: 'ROLE_GROUP', scimExternalId: input.externalId ?? null }).returning();
  await logSecurityEvent({ event: 'scim.group_provisioned', organizationId, metadata: { group: input.displayName } });
  return { groupId: g.id };
}

export async function setGroupMembers(organizationId: string, groupId: string, userIds: string[]): Promise<void> {
  const db = getDb();
  const [g] = await db.select().from(organizationGroups).where(and(eq(organizationGroups.id, groupId), eq(organizationGroups.organizationId, organizationId))).limit(1);
  if (!g) throw new AppError(404, 'Group not found.', 'scim_no_group');
  await db.delete(organizationGroupMembers).where(eq(organizationGroupMembers.groupId, groupId));
  for (const userId of userIds) {
    // Only members of THIS org may be added (tenant scoping).
    const [m] = await db.select({ id: organizationMembers.id }).from(organizationMembers).where(and(eq(organizationMembers.organizationId, organizationId), eq(organizationMembers.userId, userId))).limit(1);
    if (m) await db.insert(organizationGroupMembers).values({ groupId, userId }).onConflictDoNothing();
  }
}
