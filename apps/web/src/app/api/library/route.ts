import { NextRequest } from 'next/server';
import { requireUser } from '@/server/auth/guards';
import { activeWorkspace } from '@/server/org/workspace';
import { resolveOrgContextById } from '@/server/org/organizations';
import { getPlan } from '@/server/ai/plans';
import { handleError, ok, forbidden } from '@/lib/api';
import { librarySearchSchema, createLibraryItemSchema } from '@/lib/validation';
import { libraryEnabled } from '@/server/library/config';
import { createItem, searchItems } from '@/server/library/items';
import { createVersion } from '@/server/library/versions';

/**
 * GET  /api/library  — tenant-isolated, paginated discovery of PUBLISHED items.
 * POST /api/library  — create a DRAFT item (+ first version) under the caller's authority.
 */
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function publicItem(i: Awaited<ReturnType<typeof searchItems>>['items'][number]) {
  return {
    id: i.id,
    slug: i.slug,
    itemType: i.itemType,
    title: i.title,
    titleAr: i.titleAr,
    shortDescription: i.shortDescription,
    shortDescriptionAr: i.shortDescriptionAr,
    visibility: i.visibility,
    riskLevel: i.riskLevel,
    verified: i.verified,
    featured: i.featured,
    categories: i.categories,
    tags: i.tags,
    supportedPersonas: i.supportedPersonas,
    requiredPlans: i.requiredPlans,
    requiredConnectors: i.requiredConnectors,
    installationCount: i.installationCount,
    publisherType: i.publisherType,
  };
}

export async function GET(req: NextRequest) {
  const auth = await requireUser();
  if ('response' in auth) return auth.response;
  try {
    if (!libraryEnabled()) return forbidden('The library is not available.');
    const ws = await activeWorkspace(req, auth.user.id);
    const params = Object.fromEntries(new URL(req.url).searchParams.entries());
    const input = librarySearchSchema.parse(params);
    const res = await searchItems({ userId: auth.user.id, activeOrganizationId: ws.organizationId }, input);
    return ok({ items: res.items.map(publicItem), page: res.page, pageSize: res.pageSize, hasMore: res.hasMore });
  } catch (err) {
    return handleError(err, 'library.search');
  }
}

export async function POST(req: NextRequest) {
  const auth = await requireUser();
  if ('response' in auth) return auth.response;
  try {
    if (!libraryEnabled()) return forbidden('The library is not available.');
    const input = createLibraryItemSchema.parse(await req.json());
    const plan = await getPlan(auth.user.plan);
    if (!plan.libraryEnabled) return forbidden('Your plan does not include the library.');

    const ws = await activeWorkspace(req, auth.user.id);
    let publisherType: 'USER' | 'ORGANIZATION' = 'USER';
    let publisherOrganizationId: string | null = null;
    if (input.visibility === 'ORGANIZATION') {
      if (!ws.organizationId) return forbidden('Select an organization workspace to publish an organization item.');
      const ctx = await resolveOrgContextById(auth.user.id, ws.organizationId);
      if (!ctx || (ctx.role !== 'OWNER' && ctx.role !== 'ADMIN')) return forbidden('Organization admin required.');
      if (!plan.organizationLibraryEnabled) return forbidden('Your plan does not include organization libraries.');
      publisherType = 'ORGANIZATION';
      publisherOrganizationId = ws.organizationId;
    }

    const item = await createItem({
      itemType: input.itemType,
      title: input.title,
      titleAr: input.titleAr ?? null,
      shortDescription: input.shortDescription,
      shortDescriptionAr: input.shortDescriptionAr ?? null,
      longDescription: input.longDescription ?? null,
      publisherType,
      publisherUserId: publisherType === 'USER' ? auth.user.id : null,
      publisherOrganizationId,
      visibility: input.visibility,
      categories: input.categories,
      tags: input.tags,
      supportedPersonas: input.supportedPersonas,
      createdByUserId: auth.user.id,
    });

    const { version, validation } = await createVersion(item, {
      itemType: input.itemType,
      definition: input.definition,
      supportedPersonas: input.supportedPersonas,
      createdByUserId: auth.user.id,
    });
    return ok({ itemId: item.id, versionId: version.id, validation: { ok: validation.ok, riskLevel: validation.riskLevel, flags: validation.flags, requiredTools: validation.requiredTools, requiredConnectors: validation.requiredConnectors } });
  } catch (err) {
    return handleError(err, 'library.create');
  }
}
