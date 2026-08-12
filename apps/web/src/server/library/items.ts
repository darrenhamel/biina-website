import { and, desc, eq, ilike, inArray, or, sql } from 'drizzle-orm';
import { getDb } from '@/server/db';
import { libraryItems, libraryItemVersions } from '@/server/db/schema';
import type { LibraryItem } from '@/server/db/schema';
import { logSecurityEvent } from '@/server/auth/events';
import { getExperienceProfile } from '@/config/experience-profiles';
import { SEARCH_PAGE_DEFAULT, SEARCH_PAGE_MAX } from './config';
import { canViewItem, getOrgLibraryPolicy, orgApprovedItemIds, orgHiddenItemIds, visibleItemsFilter, type LibraryViewer } from './access';
import type { LibraryItemType } from './types';

/**
 * Library item CRUD + discovery. Discovery is tenant-isolated: the query only
 * returns items the viewer may see (BIINA_CURATED + own private + own-org + public
 * when enabled), then refines by org curation (hidden/approved-only). Search is
 * paginated; the full catalog is never loaded.
 */

export interface CreateItemInput {
  itemType: LibraryItemType;
  title: string;
  titleAr?: string | null;
  shortDescription?: string;
  shortDescriptionAr?: string | null;
  longDescription?: string | null;
  publisherType: 'BIINA' | 'ORGANIZATION' | 'USER';
  publisherUserId?: string | null;
  publisherOrganizationId?: string | null;
  visibility: 'PRIVATE' | 'ORGANIZATION' | 'BIINA_CURATED' | 'PUBLIC';
  categories?: string[];
  tags?: string[];
  supportedPersonas?: string[];
  createdByUserId: string;
}

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 120) || 'item';
}

export async function createItem(input: CreateItemInput): Promise<LibraryItem> {
  const db = getDb();
  const base = slugify(input.title);
  const slug = `${base}-${Math.abs(hashString(input.createdByUserId + base)).toString(36).slice(0, 6)}`;
  const [row] = await db
    .insert(libraryItems)
    .values({
      slug,
      itemType: input.itemType,
      title: input.title,
      titleAr: input.titleAr ?? null,
      shortDescription: input.shortDescription ?? '',
      shortDescriptionAr: input.shortDescriptionAr ?? null,
      longDescription: input.longDescription ?? null,
      publisherType: input.publisherType,
      publisherUserId: input.publisherUserId ?? null,
      publisherOrganizationId: input.publisherOrganizationId ?? null,
      visibility: input.visibility,
      status: 'DRAFT',
      categories: input.categories ?? [],
      tags: input.tags ?? [],
      supportedPersonas: input.supportedPersonas ?? [],
      verified: input.publisherType === 'BIINA',
      createdByUserId: input.createdByUserId,
    })
    .returning();
  await logSecurityEvent({ event: 'library.item_created', userId: input.createdByUserId, organizationId: input.publisherOrganizationId ?? null, metadata: { itemId: row.id, itemType: row.itemType } });
  return row;
}

export async function getItem(id: string): Promise<LibraryItem | null> {
  const [row] = await getDb().select().from(libraryItems).where(eq(libraryItems.id, id)).limit(1);
  return row ?? null;
}

export async function getItemBySlug(slug: string): Promise<LibraryItem | null> {
  const [row] = await getDb().select().from(libraryItems).where(eq(libraryItems.slug, slug)).limit(1);
  return row ?? null;
}

export interface SearchInput {
  q?: string;
  itemType?: LibraryItemType;
  persona?: string;
  category?: string;
  verifiedOnly?: boolean;
  readOnlyOnly?: boolean;
  freePlanOnly?: boolean;
  organizationApprovedOnly?: boolean;
  page?: number;
  pageSize?: number;
}

export interface SearchResult {
  items: LibraryItem[];
  page: number;
  pageSize: number;
  hasMore: boolean;
}

/** Tenant-isolated, paginated discovery. Only PUBLISHED items are surfaced. */
export async function searchItems(viewer: LibraryViewer, input: SearchInput): Promise<SearchResult> {
  const db = getDb();
  const page = Math.max(0, input.page ?? 0);
  const pageSize = Math.min(SEARCH_PAGE_MAX, Math.max(1, input.pageSize ?? SEARCH_PAGE_DEFAULT));

  const clauses = [eq(libraryItems.status, 'PUBLISHED'), visibleItemsFilter(viewer)!];
  if (input.itemType) clauses.push(eq(libraryItems.itemType, input.itemType));
  if (input.verifiedOnly) clauses.push(eq(libraryItems.verified, true));
  if (input.readOnlyOnly) clauses.push(inArray(libraryItems.riskLevel, ['CONTENT_ONLY', 'READ_ONLY']));
  if (input.q && input.q.trim()) {
    const like = `%${input.q.trim().slice(0, 80)}%`;
    clauses.push(or(ilike(libraryItems.title, like), ilike(libraryItems.titleAr, like), ilike(libraryItems.shortDescription, like), ilike(libraryItems.shortDescriptionAr, like), sql`${libraryItems.tags}::text ilike ${like}`)!);
  }
  if (input.persona) clauses.push(sql`(${libraryItems.supportedPersonas} = '[]'::jsonb OR ${libraryItems.supportedPersonas} ? ${input.persona})`);
  if (input.category) clauses.push(sql`${libraryItems.categories} ? ${input.category}`);
  if (input.freePlanOnly) clauses.push(sql`(${libraryItems.requiredPlans} = '[]'::jsonb OR ${libraryItems.requiredPlans} ? 'FREE')`);

  // Fetch one extra to compute hasMore, then apply org curation refinement in-memory.
  const rows = await db
    .select()
    .from(libraryItems)
    .where(and(...clauses))
    .orderBy(desc(libraryItems.featured), desc(libraryItems.installationCount), desc(libraryItems.publishedAt))
    .limit(pageSize + 1)
    .offset(page * pageSize);

  let refined = rows;
  if (viewer.activeOrganizationId) {
    const policy = await getOrgLibraryPolicy(viewer.activeOrganizationId);
    const hidden = await orgHiddenItemIds(viewer.activeOrganizationId);
    refined = refined.filter((r) => !hidden.has(r.id));
    // Org disabled the public marketplace → drop PUBLIC items for members.
    if (!policy.publicLibraryEnabled) refined = refined.filter((r) => r.visibility !== 'PUBLIC');
    // APPROVED_ONLY → only org-approved executable items (content items stay visible).
    if (policy.installPolicy === 'APPROVED_ONLY' || input.organizationApprovedOnly) {
      const approved = await orgApprovedItemIds(viewer.activeOrganizationId);
      refined = refined.filter((r) => r.publisherType === 'BIINA' || approved.has(r.id) || r.publisherOrganizationId === viewer.activeOrganizationId);
    }
  }

  const hasMore = refined.length > pageSize;
  return { items: refined.slice(0, pageSize), page, pageSize, hasMore };
}

/** Convenience: the persona-recommended categories for discovery grouping. */
export function personaRecommendedCategories(persona: string | null | undefined): string[] {
  return getExperienceProfile(persona).recommendedCategories;
}

export async function updateItemMeta(item: LibraryItem, patch: Partial<Pick<LibraryItem, 'title' | 'titleAr' | 'shortDescription' | 'shortDescriptionAr' | 'longDescription' | 'categories' | 'tags' | 'supportedPersonas'>>, actorUserId: string): Promise<void> {
  await getDb().update(libraryItems).set({ ...patch, updatedAt: new Date() }).where(eq(libraryItems.id, item.id));
  await logSecurityEvent({ event: 'library.item_updated', userId: actorUserId, organizationId: item.publisherOrganizationId ?? null, metadata: { itemId: item.id } });
}

export async function setItemStatus(itemId: string, status: LibraryItem['status'], actorUserId: string, extra: Partial<LibraryItem> = {}): Promise<void> {
  await getDb().update(libraryItems).set({ status, updatedAt: new Date(), ...extra }).where(eq(libraryItems.id, itemId));
}

export async function bumpInstallCount(itemId: string, delta: number): Promise<void> {
  await getDb().update(libraryItems).set({ installationCount: sql`${libraryItems.installationCount} + ${delta}` }).where(eq(libraryItems.id, itemId));
}

function hashString(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  return h;
}
