import { and, eq } from 'drizzle-orm';
import { getDb } from '@/server/db';
import { libraryOrgCuration, libraryOrgSettings } from '@/server/db/schema';
import type { LibraryOrgSettings } from '@/server/db/schema';
import { logSecurityEvent } from '@/server/auth/events';

/**
 * Organization library curation. Admins may recommend/hide/approve items, pin a
 * version, and set an org-wide install policy (OPEN vs APPROVED_ONLY), disable the
 * public marketplace for members, and forbid write-capable installs. This is
 * curation ON TOP of the existing authorization system — it never grants access.
 */

export async function getOrgSettings(organizationId: string): Promise<LibraryOrgSettings> {
  const [row] = await getDb().select().from(libraryOrgSettings).where(eq(libraryOrgSettings.organizationId, organizationId)).limit(1);
  if (row) return row;
  const [created] = await getDb().insert(libraryOrgSettings).values({ organizationId }).returning();
  return created;
}

export async function updateOrgSettings(
  organizationId: string,
  patch: Partial<Pick<LibraryOrgSettings, 'publicLibraryEnabled' | 'installPolicy' | 'writeCapableAllowed'>>,
  adminUserId: string,
): Promise<LibraryOrgSettings> {
  await getOrgSettings(organizationId); // ensure row exists
  const [row] = await getDb()
    .update(libraryOrgSettings)
    .set({ ...patch, updatedByUserId: adminUserId, updatedAt: new Date() })
    .where(eq(libraryOrgSettings.organizationId, organizationId))
    .returning();
  await logSecurityEvent({ event: 'library.org_policy_changed', actorUserId: adminUserId, organizationId, metadata: { ...patch } });
  return row;
}

export type OrgItemState = 'RECOMMENDED' | 'HIDDEN' | 'APPROVED';

export async function setItemCuration(organizationId: string, libraryItemId: string, state: OrgItemState, adminUserId: string, pinnedVersionId?: string | null): Promise<void> {
  const db = getDb();
  const [existing] = await db.select().from(libraryOrgCuration).where(and(eq(libraryOrgCuration.organizationId, organizationId), eq(libraryOrgCuration.libraryItemId, libraryItemId))).limit(1);
  if (existing) {
    await db.update(libraryOrgCuration).set({ state, pinnedVersionId: pinnedVersionId ?? existing.pinnedVersionId, setByUserId: adminUserId }).where(eq(libraryOrgCuration.id, existing.id));
  } else {
    await db.insert(libraryOrgCuration).values({ organizationId, libraryItemId, state, pinnedVersionId: pinnedVersionId ?? null, setByUserId: adminUserId });
  }
  await logSecurityEvent({ event: 'library.org_curation_changed', actorUserId: adminUserId, organizationId, metadata: { libraryItemId, state } });
}

export async function clearItemCuration(organizationId: string, libraryItemId: string, adminUserId: string): Promise<void> {
  await getDb().delete(libraryOrgCuration).where(and(eq(libraryOrgCuration.organizationId, organizationId), eq(libraryOrgCuration.libraryItemId, libraryItemId)));
  await logSecurityEvent({ event: 'library.org_curation_changed', actorUserId: adminUserId, organizationId, metadata: { libraryItemId, state: 'CLEARED' } });
}
