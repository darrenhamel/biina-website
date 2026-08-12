import { NextRequest } from 'next/server';
import { requireUser } from '@/server/auth/guards';
import { activeWorkspace } from '@/server/org/workspace';
import { handleError, ok, notFound, forbidden } from '@/lib/api';
import { resolveResearchAccess } from '@/server/research/sessions';
import { cancelResearch } from '@/server/research/orchestrator';

/** POST /api/research/[id]/cancel — stop new tasks; completed evidence remains. */
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireUser();
  if ('response' in auth) return auth.response;
  try {
    const ws = await activeWorkspace(req, auth.user.id);
    const access = await resolveResearchAccess(auth.user.id, params.id, ws.organizationId);
    if (!access) return notFound('Research not found');
    if (!access.canManage) return forbidden('You cannot cancel this research.');
    await cancelResearch(params.id);
    return ok({ ok: true, status: 'CANCELED' });
  } catch (err) {
    return handleError(err, 'research.cancel');
  }
}
