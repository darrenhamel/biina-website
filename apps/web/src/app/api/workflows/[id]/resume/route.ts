import { NextRequest } from 'next/server';
import { requireUser } from '@/server/auth/guards';
import { activeWorkspace } from '@/server/org/workspace';
import { handleError, ok, notFound, forbidden } from '@/lib/api';
import { resolveWorkflowAccess, setWorkflowStatus } from '@/server/workflows/store';

/** POST /api/workflows/[id]/resume — resume a PAUSED/AUTO_PAUSED workflow. */
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireUser();
  if ('response' in auth) return auth.response;
  try {
    const ws = await activeWorkspace(req, auth.user.id);
    const access = await resolveWorkflowAccess(auth.user.id, params.id, ws.organizationId);
    if (!access) return notFound('Workflow not found');
    if (!access.canManage) return forbidden('You cannot resume this workflow.');
    if (!['PAUSED', 'AUTO_PAUSED'].includes(access.workflow.status)) return ok({ ok: false, error: 'Not paused' }, { status: 400 });
    await setWorkflowStatus(params.id, 'ACTIVE', auth.user.id); // recomputes nextRunAt deterministically
    return ok({ ok: true, status: 'ACTIVE' });
  } catch (err) {
    return handleError(err, 'workflows.resume');
  }
}
