import { NextRequest } from 'next/server';
import { requireUser } from '@/server/auth/guards';
import { activeWorkspace } from '@/server/org/workspace';
import { getPlan } from '@/server/ai/plans';
import { handleError, ok, notFound } from '@/lib/api';
import { logSecurityEvent } from '@/server/auth/events';
import { resolveItemAccess } from '@/server/library/access';
import { installItem } from '@/server/library/installations';

/**
 * POST /api/library/[id]/install — install the item's current version as a controlled
 * local instance. Grants NO permission; executable items install as DRAFT.
 */
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireUser();
  if ('response' in auth) return auth.response;
  try {
    const ws = await activeWorkspace(req, auth.user.id);
    const viewer = { userId: auth.user.id, activeOrganizationId: ws.organizationId };
    const access = await resolveItemAccess(viewer, params.id);
    if (!access) return notFound('Item not found.');
    const plan = await getPlan(auth.user.plan);
    try {
      const installation = await installItem(viewer, access.item, plan);
      return ok({ installationId: installation.id, status: installation.status, installedDefinitionType: installation.installedDefinitionType, installedDefinitionId: installation.installedDefinitionId });
    } catch (err) {
      await logSecurityEvent({ event: 'library.install_blocked', userId: auth.user.id, organizationId: ws.organizationId, metadata: { itemId: params.id, reason: (err as { code?: string })?.code ?? 'error' } });
      throw err;
    }
  } catch (err) {
    return handleError(err, 'library.install');
  }
}
