import { NextRequest } from 'next/server';
import { requireUser } from '@/server/auth/guards';
import { activeWorkspace } from '@/server/org/workspace';
import { handleError, ok, notFound } from '@/lib/api';
import { resolveSessionAccess, listSteps, listActions } from '@/server/agent/sessions';
import { getDb } from '@/server/db';
import { approvalRequests } from '@/server/db/schema';
import { and, eq } from 'drizzle-orm';

/** GET /api/agent/sessions/[id] — run detail: plan, steps, actions, pending approval. */
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireUser();
  if ('response' in auth) return auth.response;
  try {
    const ws = await activeWorkspace(req, auth.user.id);
    const access = await resolveSessionAccess(auth.user.id, params.id, ws.organizationId);
    if (!access) return notFound('Session not found');

    const [steps, actions] = await Promise.all([listSteps(params.id), listActions(params.id)]);

    // Surface a single pending approval (if the run is paused) with its safe preview.
    let pendingApproval = null;
    if (access.session.status === 'AWAITING_APPROVAL') {
      const [pending] = await getDb().select().from(approvalRequests).where(and(eq(approvalRequests.agentSessionId, params.id), eq(approvalRequests.status, 'PENDING'))).limit(1);
      if (pending) pendingApproval = { id: pending.id, toolId: pending.toolId, riskLevel: pending.riskLevel, expiresAt: pending.expiresAt, preview: pending.preview };
    }

    return ok({
      session: {
        id: access.session.id,
        status: access.session.status,
        mode: access.session.mode,
        goal: access.session.goal,
        plan: access.session.plan ?? [],
        stepsUsed: access.session.stepsUsed,
        writeActionsUsed: access.session.writeActionsUsed,
        estimatedCost: access.session.estimatedCost,
        dryRun: access.session.dryRun,
        createdAt: access.session.createdAt,
        completedAt: access.session.completedAt,
      },
      steps: steps.map((s) => ({ index: s.stepIndex, type: s.stepType, toolId: s.toolId, status: s.status, input: s.inputSummary, output: s.outputSummary })),
      actions: actions.map((a) => ({ id: a.id, toolId: a.toolId, risk: a.riskLevel, status: a.status, externalResourceId: a.externalResourceId, resultSummary: a.resultSummary })),
      pendingApproval,
    });
  } catch (err) {
    return handleError(err, 'agent.session.detail');
  }
}
