import { NextRequest } from 'next/server';
import { requireUser } from '@/server/auth/guards';
import { activeWorkspace } from '@/server/org/workspace';
import { getPlan } from '@/server/ai/plans';
import { handleError, ok, notFound, forbidden } from '@/lib/api';
import { resolveWorkflowAccess, getTrigger, setWorkflowStatus } from '@/server/workflows/store';
import { assertUnderActiveWorkflowLimit } from '@/server/workflows/quotas';
import { isValidTimezone, computeNextRun, type Schedule } from '@/server/workflows/schedule';
import { logSecurityEvent } from '@/server/auth/events';

/** POST /api/workflows/[id]/activate — validate, then enable scheduling. */
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireUser();
  if ('response' in auth) return auth.response;
  try {
    const ws = await activeWorkspace(req, auth.user.id);
    const access = await resolveWorkflowAccess(auth.user.id, params.id, ws.organizationId);
    if (!access) return notFound('Workflow not found');
    if (!access.canManage) return forbidden('You cannot activate this workflow.');

    const wf = access.workflow;
    const plan = await getPlan(auth.user.plan);
    if (!plan.workflowsEnabled) return forbidden('Your plan does not include workflows.');

    const trigger = await getTrigger(params.id);
    if (trigger && (trigger.type === 'SCHEDULE' || trigger.type === 'CONDITION') && !plan.scheduledAutomationsEnabled) {
      return forbidden('Your plan does not include scheduled automations.');
    }
    // Validate schedule + timezone produce a real next run.
    if (!isValidTimezone(wf.timezone)) return ok({ ok: false, error: 'Invalid timezone' }, { status: 400 });
    if (trigger?.type === 'SCHEDULE') {
      if (!trigger.schedule || !computeNextRun(trigger.schedule as Schedule, wf.timezone)) return ok({ ok: false, error: 'Schedule produces no next run' }, { status: 400 });
    }
    await assertUnderActiveWorkflowLimit({ userId: auth.user.id, organizationId: wf.organizationId }, plan);

    await setWorkflowStatus(params.id, 'ACTIVE', auth.user.id); // recomputes nextRunAt
    await logSecurityEvent({ event: 'workflow.activated', userId: auth.user.id, actorUserId: auth.user.id, organizationId: ws.organizationId, metadata: { workflowId: params.id } });
    return ok({ ok: true, status: 'ACTIVE' });
  } catch (err) {
    return handleError(err, 'workflows.activate');
  }
}
