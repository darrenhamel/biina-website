import { and, eq, or } from 'drizzle-orm';
import { getDb } from '@/server/db';
import { libraryItems, libraryOrgCuration, libraryOrgSettings } from '@/server/db/schema';
import type { LibraryItem } from '@/server/db/schema';
import { resolveOrgContextById } from '@/server/org/organizations';
import { publicLibraryEnabled as platformPublicEnabled, itemSuspendedByPlatform } from './config';

/**
 * Library visibility + tenant isolation. A PRIVATE item is owner-only; an
 * ORGANIZATION item is visible only to VERIFIED members of that org; BIINA_CURATED
 * and PUBLIC are visible to everyone (PUBLIC only when enabled). Access is always
 * resolved server-side — never trusted from the browser. Org A's private items are
 * never visible or installable by Org B.
 */

export interface LibraryViewer {
  userId: string;
  activeOrganizationId: string | null;
}

export interface ItemAccess {
  item: LibraryItem;
  /** The viewer may see the item in discovery / preview it. */
  canView: boolean;
  /** The viewer owns/publishes it (can edit drafts, submit, publish own private). */
  canManage: boolean;
}

/** Whether a viewer may VIEW an already-loaded item (visibility + tenant rules). */
export async function canViewItem(viewer: LibraryViewer, item: LibraryItem): Promise<boolean> {
  if (itemSuspendedByPlatform(item.slug) || itemSuspendedByPlatform(item.id)) {
    // Suspended items are hidden from discovery for everyone but the platform.
    return false;
  }
  switch (item.visibility) {
    case 'PRIVATE':
      return item.publisherUserId === viewer.userId;
    case 'ORGANIZATION': {
      if (!item.publisherOrganizationId) return false;
      if (item.publisherOrganizationId !== viewer.activeOrganizationId) return false;
      const ctx = await resolveOrgContextById(viewer.userId, item.publisherOrganizationId);
      return ctx != null;
    }
    case 'BIINA_CURATED':
      return true;
    case 'PUBLIC':
      return platformPublicEnabled();
  }
}

/** Whether a viewer MANAGES an item (owner of a private item, or publisher org admin). */
export async function canManageItem(viewer: LibraryViewer, item: LibraryItem): Promise<boolean> {
  if (item.publisherType === 'USER') return item.publisherUserId === viewer.userId;
  if (item.publisherType === 'ORGANIZATION') {
    if (!item.publisherOrganizationId || item.publisherOrganizationId !== viewer.activeOrganizationId) return false;
    const ctx = await resolveOrgContextById(viewer.userId, item.publisherOrganizationId);
    return ctx != null && (ctx.role === 'OWNER' || ctx.role === 'ADMIN');
  }
  return false; // BIINA items are managed by platform admins only.
}

export async function resolveItemAccess(viewer: LibraryViewer, itemId: string): Promise<ItemAccess | null> {
  const [item] = await getDb().select().from(libraryItems).where(eq(libraryItems.id, itemId)).limit(1);
  if (!item) return null;
  const canView = await canViewItem(viewer, item);
  const canManage = await canManageItem(viewer, item);
  if (!canView && !canManage) return null;
  return { item, canView, canManage };
}

/**
 * The org's library policy (curation). Defaults are permissive; an org can disable
 * the public marketplace for members and/or require APPROVED_ONLY installs.
 */
export interface OrgLibraryPolicy {
  publicLibraryEnabled: boolean;
  installPolicy: 'OPEN' | 'APPROVED_ONLY';
  writeCapableAllowed: boolean;
}

export async function getOrgLibraryPolicy(organizationId: string | null): Promise<OrgLibraryPolicy> {
  if (!organizationId) return { publicLibraryEnabled: true, installPolicy: 'OPEN', writeCapableAllowed: true };
  const [row] = await getDb().select().from(libraryOrgSettings).where(eq(libraryOrgSettings.organizationId, organizationId)).limit(1);
  if (!row) return { publicLibraryEnabled: true, installPolicy: 'OPEN', writeCapableAllowed: true };
  return {
    publicLibraryEnabled: row.publicLibraryEnabled,
    installPolicy: (row.installPolicy as 'OPEN' | 'APPROVED_ONLY') ?? 'OPEN',
    writeCapableAllowed: row.writeCapableAllowed,
  };
}

/** Org curation state for a specific item (RECOMMENDED / HIDDEN / APPROVED + pin). */
export async function getOrgCuration(organizationId: string, libraryItemId: string) {
  const [row] = await getDb()
    .select()
    .from(libraryOrgCuration)
    .where(and(eq(libraryOrgCuration.organizationId, organizationId), eq(libraryOrgCuration.libraryItemId, libraryItemId)))
    .limit(1);
  return row ?? null;
}

/** The set of item ids an org has explicitly APPROVED (for APPROVED_ONLY mode). */
export async function orgApprovedItemIds(organizationId: string): Promise<Set<string>> {
  const rows = await getDb().select({ id: libraryOrgCuration.libraryItemId }).from(libraryOrgCuration).where(and(eq(libraryOrgCuration.organizationId, organizationId), eq(libraryOrgCuration.state, 'APPROVED')));
  return new Set(rows.map((r) => r.id));
}

/** The set of item ids an org has HIDDEN from members. */
export async function orgHiddenItemIds(organizationId: string): Promise<Set<string>> {
  const rows = await getDb().select({ id: libraryOrgCuration.libraryItemId }).from(libraryOrgCuration).where(and(eq(libraryOrgCuration.organizationId, organizationId), eq(libraryOrgCuration.state, 'HIDDEN')));
  return new Set(rows.map((r) => r.id));
}

/** A drizzle filter for items a viewer can potentially VIEW (pre-membership-refine). */
export function visibleItemsFilter(viewer: LibraryViewer) {
  const clauses = [eq(libraryItems.visibility, 'BIINA_CURATED'), eq(libraryItems.publisherUserId, viewer.userId)];
  if (platformPublicEnabled()) clauses.push(eq(libraryItems.visibility, 'PUBLIC'));
  if (viewer.activeOrganizationId) {
    clauses.push(and(eq(libraryItems.visibility, 'ORGANIZATION'), eq(libraryItems.publisherOrganizationId, viewer.activeOrganizationId))!);
  }
  return or(...clauses);
}
