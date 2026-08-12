import { NextRequest } from 'next/server';
import { requireUser } from '@/server/auth/guards';
import { isOrgManager } from '@/server/auth/permissions';
import { activeWorkspace } from '@/server/org/workspace';
import { getPlan } from '@/server/ai/plans';
import { createWorkflowSchema } from '@/lib/validation';
import { handleError, ok, forbidden } from '@/lib/api';
import { workflowsEnabled } from '@/server/workflows/config';
import { createWorkflow, validateWorkflowConfig } from '@/server/workflows/compiler';
import { listWorkflowsForScope } from '@/server/workflows/store';

/**
 * POST /api/workflows — create a workflow (starts as DRAFT; never auto-scheduled).
 * GET  /api/workflows — list workflows in the active scope (personal or org).
 */
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  const auth = await requireUser();
  if ('response' in auth) return auth.response;
  const user = auth.user;
  try {
    if (!workflowsEnabled()) return forbidden('Workflows are currently disabled.');
    const input = createWorkflowSchema.parse(await req.json());
    const plan = await getPlan(user.plan);
    if (!plan.workflowsEnabled) return forbidden('Your plan does not include workflows.');

    const ws = await activeWorkspace(req, user.id);
    if (input.ownerType === 'ORGANIZATION') {
      if (!ws.organizationId || !ws.role || !isOrgManager(ws.role as 'OWNER' | 'ADMIN' | 'MEMBER')) return forbidden('Only organization managers can create organization workflows.');
    }
    const issues = validateWorkflowConfig(input);
    if (issues.length) return ok({ ok: false, issues }, { status: 400 });

    const wf = await createWorkflow(input, { userId: user.id, organizationId: input.ownerType === 'ORGANIZATION' ? ws.organizationId : null });
    return ok({ ok: true, workflow: { id: wf.id, name: wf.name, status: wf.status } });
  } catch (err) {
    return handleError(err, 'workflows.create');
  }
}

export async function GET(req: NextRequest) {
  const auth = await requireUser();
  if ('response' in auth) return auth.response;
  try {
    const ws = await activeWorkspace(req, auth.user.id);
    const rows = await listWorkflowsForScope({ userId: auth.user.id, organizationId: ws.organizationId });
    return ok({
      workflows: rows.map((w) => ({ id: w.id, name: w.name, description: w.description, status: w.status, triggerType: w.triggerType, timezone: w.timezone, approvalPolicy: w.approvalPolicy, nextRunAt: w.nextRunAt, lastRunAt: w.lastRunAt })),
    });
  } catch (err) {
    return handleError(err, 'workflows.list');
  }
}
