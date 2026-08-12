import { NextRequest } from 'next/server';
import { z } from 'zod';
import { requireUser } from '@/server/auth/guards';
import { activeWorkspace } from '@/server/org/workspace';
import { handleError, ok, notFound, forbidden } from '@/lib/api';
import { getRun } from '@/server/workflows/runs';
import { resolveWorkflowAccess, getWorkflow } from '@/server/workflows/store';
import { resumeWorkflowRunAfterDecision } from '@/server/workflows/runner';

/** POST /api/workflows/runs/[runId]/approve — approve/reject a paused workflow run. */
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const bodySchema = z.object({ approvalId: z.string().uuid(), decision: z.enum(['APPROVED', 'REJECTED']) }).strict();

export async function POST(req: NextRequest, { params }: { params: { runId: string } }) {
  const auth = await requireUser();
  if ('response' in auth) return auth.response;
  try {
    const run = await getRun(params.runId);
    if (!run) return notFound('Run not found');
    const ws = await activeWorkspace(req, auth.user.id);
    const access = await resolveWorkflowAccess(auth.user.id, run.workflowId, ws.organizationId);
    if (!access) return notFound('Run not found');
    if (!access.canManage) return forbidden('You cannot approve this run.');
    if (run.status !== 'AWAITING_APPROVAL') return ok({ ok: false, error: 'Run is not awaiting approval' }, { status: 400 });

    const { approvalId, decision } = bodySchema.parse(await req.json());
    const workflow = (await getWorkflow(run.workflowId))!;
    const status = await resumeWorkflowRunAfterDecision({ run, workflow, approvalId, decision, actorUserId: auth.user.id, organizationId: ws.organizationId });
    return ok({ ok: true, status });
  } catch (err) {
    return handleError(err, 'workflows.run.approve');
  }
}
