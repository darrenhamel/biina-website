import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { getDb } from '@/server/db';
import { organizations, organizationMembers, users } from '@/server/db/schema';
import type { Organization, OrganizationMember } from '@/server/db/schema';
import type { OrgRole } from '@/server/auth/permissions';
import { logSecurityEvent } from '@/server/auth/events';
import { badRequest, conflict } from '@/lib/errors';
import { normalizeSlug, validateSlug } from './slug';

/**
 * Organizations + the SECURITY-CRITICAL context resolver.
 *
 * `resolveOrgContext` is the single trusted way to derive a user's role in an
 * organization: it verifies ACTIVE membership server-side. A browser-supplied
 * organizationId is NEVER trusted — callers must go through this.
 */

export interface OrgContext {
  org: Organization;
  role: OrgRole;
  membership: OrganizationMember;
}

/** Resolve verified org context for a user by slug, or null if not a member. */
export async function resolveOrgContext(userId: string, slug: string): Promise<OrgContext | null> {
  const db = getDb();
  const [org] = await db.select().from(organizations).where(eq(organizations.slug, slug)).limit(1);
  if (!org) return null;
  const [membership] = await db
    .select()
    .from(organizationMembers)
    .where(and(eq(organizationMembers.organizationId, org.id), eq(organizationMembers.userId, userId)))
    .limit(1);
  if (!membership) return null; // not a member → no access (IDOR-safe)
  return { org, role: membership.role, membership };
}

/** Same as above but by org id (used when an id is already trusted). */
export async function resolveOrgContextById(userId: string, orgId: string): Promise<OrgContext | null> {
  const db = getDb();
  const [org] = await db.select().from(organizations).where(eq(organizations.id, orgId)).limit(1);
  if (!org) return null;
  const [membership] = await db
    .select()
    .from(organizationMembers)
    .where(and(eq(organizationMembers.organizationId, org.id), eq(organizationMembers.userId, userId)))
    .limit(1);
  if (!membership) return null;
  return { org, role: membership.role, membership };
}

export async function listUserOrgs(userId: string) {
  return getDb()
    .select({
      id: organizations.id,
      slug: organizations.slug,
      displayName: organizations.displayName,
      status: organizations.status,
      role: organizationMembers.role,
    })
    .from(organizationMembers)
    .innerJoin(organizations, eq(organizations.id, organizationMembers.organizationId))
    .where(eq(organizationMembers.userId, userId))
    .orderBy(organizations.displayName);
}

export async function createOrganization(
  user: { id: string },
  input: { name: string; slug?: string },
  meta: { ip?: string | null; userAgent?: string | null } = {},
): Promise<Organization> {
  const slug = normalizeSlug(input.slug || input.name);
  const v = validateSlug(slug);
  if (!v.ok) throw badRequest(`Invalid slug: ${v.error}`);

  const db = getDb();
  const [existing] = await db.select({ id: organizations.id }).from(organizations).where(eq(organizations.slug, slug)).limit(1);
  if (existing) throw conflict('That workspace URL is already taken');

  const org = await db.transaction(async (tx) => {
    const [created] = await tx
      .insert(organizations)
      .values({ slug, name: input.name.trim(), displayName: input.name.trim(), createdByUserId: user.id })
      .returning();
    await tx.insert(organizationMembers).values({ organizationId: created.id, userId: user.id, role: 'OWNER' });
    return created;
  });

  await logSecurityEvent({
    event: 'org.created',
    userId: user.id,
    actorUserId: user.id,
    organizationId: org.id,
    ip: meta.ip,
    userAgent: meta.userAgent,
    metadata: { slug },
  });
  return org;
}

export async function updateOrgSettings(orgId: string, patch: { displayName?: string }, actorUserId: string) {
  const set: Record<string, unknown> = { updatedAt: new Date() };
  if (patch.displayName !== undefined) set.displayName = patch.displayName.trim();
  await getDb().update(organizations).set(set).where(eq(organizations.id, orgId));
  await logSecurityEvent({ event: 'org.settings.changed', actorUserId, organizationId: orgId, metadata: set });
  return { ok: true };
}

// ---- Platform-admin operations ----

export async function listAllOrgs(limit = 100) {
  const db = getDb();
  const orgs = await db
    .select({
      id: organizations.id,
      slug: organizations.slug,
      displayName: organizations.displayName,
      status: organizations.status,
      createdAt: organizations.createdAt,
    })
    .from(organizations)
    .orderBy(desc(organizations.createdAt))
    .limit(limit);
  if (orgs.length === 0) return [];

  const ids = orgs.map((o) => o.id);
  // Member counts + owner emails as separate grouped queries, merged in JS —
  // clearer and safer than correlated subqueries.
  const [counts, owners] = await Promise.all([
    db
      .select({ organizationId: organizationMembers.organizationId, n: sql<number>`count(*)::int` })
      .from(organizationMembers)
      .where(inArray(organizationMembers.organizationId, ids))
      .groupBy(organizationMembers.organizationId),
    db
      .select({ organizationId: organizationMembers.organizationId, email: users.email })
      .from(organizationMembers)
      .innerJoin(users, eq(users.id, organizationMembers.userId))
      .where(and(inArray(organizationMembers.organizationId, ids), eq(organizationMembers.role, 'OWNER'))),
  ]);

  const countBy = new Map(counts.map((c) => [c.organizationId, c.n] as const));
  const ownerBy = new Map<string, string>();
  for (const o of owners) if (!ownerBy.has(o.organizationId)) ownerBy.set(o.organizationId, o.email);

  return orgs.map((o) => ({
    ...o,
    members: countBy.get(o.id) ?? 0,
    ownerEmail: ownerBy.get(o.id) ?? null,
  }));
}

export async function setOrgStatus(orgId: string, status: 'ACTIVE' | 'SUSPENDED', actorUserId: string, reason?: string) {
  await getDb()
    .update(organizations)
    .set({ status, suspendedReason: status === 'SUSPENDED' ? reason ?? null : null, updatedAt: new Date() })
    .where(eq(organizations.id, orgId));
  await logSecurityEvent({
    event: status === 'SUSPENDED' ? 'org.suspended' : 'org.reactivated',
    actorUserId,
    organizationId: orgId,
    metadata: reason ? { reason } : undefined,
  });
  return { ok: true };
}
