import { NextRequest } from 'next/server';
import { requireUser } from '@/server/auth/guards';
import { activeWorkspace } from '@/server/org/workspace';
import { handleError, ok, notFound, forbidden } from '@/lib/api';
import { resolveWorkflowAccess, setWorkflowStatus } from '@/server/workflows/store';

/** POST /api/workflows/[id]/pause — immediate temporary stop (no new runs). */
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireUser();
  if ('response' in auth) return auth.response;
  try {
    const ws = await activeWorkspace(req, auth.user.id);
    const access = await resolveWorkflowAccess(auth.user.id, params.id, ws.organizationId);
    if (!access) return notFound('Workflow not found');
    if (!access.canManage) return forbidden('You cannot pause this workflow.');
    await setWorkflowStatus(params.id, 'PAUSED', auth.user.id); // clears nextRunAt
    return ok({ ok: true, status: 'PAUSED' });
  } catch (err) {
    return handleError(err, 'workflows.pause');
  }
}
