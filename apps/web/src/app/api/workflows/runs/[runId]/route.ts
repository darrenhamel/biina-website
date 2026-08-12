import { NextRequest } from 'next/server';
import { requireUser } from '@/server/auth/guards';
import { activeWorkspace } from '@/server/org/workspace';
import { handleError, ok, notFound } from '@/lib/api';
import { getRun, runDetail } from '@/server/workflows/runs';
import { resolveWorkflowAccess } from '@/server/workflows/store';
import { getDb } from '@/server/db';
import { approvalRequests } from '@/server/db/schema';
import { and, eq } from 'drizzle-orm';

/** GET /api/workflows/runs/[runId] — run detail (operational steps, no reasoning). */
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(req: NextRequest, { params }: { params: { runId: string } }) {
  const auth = await requireUser();
  if ('response' in auth) return auth.response;
  try {
    const run = await getRun(params.runId);
    if (!run) return notFound('Run not found');
    const ws = await activeWorkspace(req, auth.user.id);
    const access = await resolveWorkflowAccess(auth.user.id, run.workflowId, ws.organizationId);
    if (!access) return notFound('Run not found');

    const detail = await runDetail(run);
    let pendingApproval = null;
    if (run.status === 'AWAITING_APPROVAL' && run.agentSessionId) {
      const [pending] = await getDb().select().from(approvalRequests).where(and(eq(approvalRequests.agentSessionId, run.agentSessionId), eq(approvalRequests.status, 'PENDING'))).limit(1);
      if (pending) pendingApproval = { id: pending.id, toolId: pending.toolId, riskLevel: pending.riskLevel, expiresAt: pending.expiresAt, preview: pending.preview };
    }
    return ok({
      run: { id: run.id, status: run.status, trigger: run.triggerType, dryRun: run.dryRun, stepsExecuted: run.stepsExecuted, writeActions: run.writeActions, estimatedCost: run.estimatedCost, errorCode: run.errorCode, resultSummary: run.resultSummary, startedAt: run.startedAt, completedAt: run.completedAt },
      steps: detail.steps,
      pendingApproval,
    });
  } catch (err) {
    return handleError(err, 'workflows.run.detail');
  }
}
