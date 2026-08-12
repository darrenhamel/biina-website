import { NextRequest } from 'next/server';
import { requireUser } from '@/server/auth/guards';
import { activeWorkspace } from '@/server/org/workspace';
import { getPlan } from '@/server/ai/plans';
import { handleError, ok, notFound, forbidden } from '@/lib/api';
import { resolveItemAccess } from '@/server/library/access';
import { forkItem } from '@/server/library/updates';

/** POST /api/library/[id]/fork — create a private, customizable copy (provenance kept). */
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireUser();
  if ('response' in auth) return auth.response;
  try {
    const plan = await getPlan(auth.user.plan);
    if (!plan.libraryEnabled) return forbidden('Your plan does not include the library.');
    const ws = await activeWorkspace(req, auth.user.id);
    const viewer = { userId: auth.user.id, activeOrganizationId: ws.organizationId };
    const access = await resolveItemAccess(viewer, params.id);
    if (!access) return notFound('Item not found.');
    const fork = await forkItem(viewer, access.item);
    return ok({ itemId: fork.id, slug: fork.slug, status: fork.status, visibility: fork.visibility });
  } catch (err) {
    return handleError(err, 'library.fork');
  }
}
