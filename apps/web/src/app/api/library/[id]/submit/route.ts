import { NextRequest } from 'next/server';
import { requireUser } from '@/server/auth/guards';
import { activeWorkspace } from '@/server/org/workspace';
import { handleError, ok, notFound, forbidden, badRequest } from '@/lib/api';
import { resolveItemAccess } from '@/server/library/access';
import { currentPublishedVersion, listVersions } from '@/server/library/versions';
import { submitForReview } from '@/server/library/review';

/** POST /api/library/[id]/submit — submit the latest DRAFT version for review. */
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
    if (!access.canManage) return forbidden('You cannot submit this item.');
    const versions = await listVersions(params.id);
    const draft = versions.find((v) => v.status === 'DRAFT');
    if (!draft) return badRequest('No draft version to submit.');
    const review = await submitForReview(access.item, draft, auth.user.id);
    return ok({ reviewId: review.id, status: review.status });
  } catch (err) {
    return handleError(err, 'library.submit');
  }
}
