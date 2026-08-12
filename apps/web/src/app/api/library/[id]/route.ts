import { NextRequest } from 'next/server';
import { requireUser } from '@/server/auth/guards';
import { activeWorkspace } from '@/server/org/workspace';
import { getPlan } from '@/server/ai/plans';
import { handleError, ok, notFound } from '@/lib/api';
import { resolveItemAccess } from '@/server/library/access';
import { currentPublishedVersion, listVersions } from '@/server/library/versions';
import { installDisclosure } from '@/server/library/installations';

/** GET /api/library/[id] — item detail + current version manifest + install disclosure. */
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireUser();
  if ('response' in auth) return auth.response;
  try {
    const ws = await activeWorkspace(req, auth.user.id);
    const viewer = { userId: auth.user.id, activeOrganizationId: ws.organizationId };
    const access = await resolveItemAccess(viewer, params.id);
    if (!access) return notFound('Item not found.');
    const { item, canManage } = access;
    const version = await currentPublishedVersion(item);
    const plan = await getPlan(auth.user.plan);
    const disclosure = version ? await installDisclosure(viewer, item, version, plan) : null;

    return ok({
      item: {
        id: item.id,
        slug: item.slug,
        itemType: item.itemType,
        title: item.title,
        titleAr: item.titleAr,
        shortDescription: item.shortDescription,
        shortDescriptionAr: item.shortDescriptionAr,
        longDescription: item.longDescription,
        longDescriptionAr: item.longDescriptionAr,
        visibility: item.visibility,
        status: item.status,
        riskLevel: item.riskLevel,
        verified: item.verified,
        featured: item.featured,
        categories: item.categories,
        tags: item.tags,
        supportedPersonas: item.supportedPersonas,
        requiredPlans: item.requiredPlans,
        requiredConnectors: item.requiredConnectors,
        requiredTools: item.requiredTools,
        requiredCapabilities: item.requiredCapabilities,
        publisherType: item.publisherType,
        installationCount: item.installationCount,
        ratingCount: item.ratingCount,
        ratingSum: item.ratingSum,
      },
      version: version ? { id: version.id, version: version.version, changeNotes: version.changeNotes, manifest: version.manifest, configHash: version.configHash } : null,
      disclosure,
      canManage,
      versions: canManage ? (await listVersions(item.id)).map((v) => ({ id: v.id, version: v.version, status: v.status, riskLevel: v.riskLevel, createdAt: v.createdAt })) : undefined,
    });
  } catch (err) {
    return handleError(err, 'library.detail');
  }
}
