import { NextRequest, NextResponse } from 'next/server';
import { requireUser } from '@/server/auth/guards';
import { isPlatformAdmin } from '@/server/auth/permissions';
import { activeWorkspace } from '@/server/org/workspace';
import type { RouteContext } from '@/server/ai/routing';
import { getPlan } from '@/server/ai/plans';
import { approvalDecisionSchema } from '@/lib/validation';
import { handleError, notFound, badRequest } from '@/lib/api';
import { logSecurityEvent } from '@/server/auth/events';
import { resolveSessionAccess, getSession, getAction, createAction, addStep } from '@/server/agent/sessions';
import { getApproval, decideApproval, createApproval, expireApproval } from '@/server/agent/approvals';
import { getAgentTool } from '@/server/agent/tool-catalog';
import { normalizeArguments, hashArguments, idempotencyKey } from '@/server/agent/hashing';
import { buildActionPreview } from '@/server/agent/preview';
import { updateAction } from '@/server/agent/sessions';
import { advanceAgentSession, resumeAfterApproval } from '@/server/agent/orchestrator';

/**
 * POST /api/agent/approvals/[id] — approve, reject, or edit-then-approve a pending
 * action. Approval is server-authoritative: ownership, expiry, single-use, and the
 * arguments hash are all enforced server-side. An EDIT rebinds a NEW hash and voids
 * the prior approval, so execution always uses exactly what the user approved.
 */
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireUser();
  if ('response' in auth) return auth.response;
  const user = auth.user;
  try {
    const { decision, editedArguments } = approvalDecisionSchema.parse(await req.json());

    const approval = await getApproval(params.id);
    if (!approval) return notFound('Approval not found');

    const ws = await activeWorkspace(req, user.id);
    const access = await resolveSessionAccess(user.id, approval.agentSessionId, ws.organizationId);
    if (!access) return notFound('Session not found');
    if (!access.canManage) return badRequest('You cannot decide this approval.');

    const orgId = ws.organizationId;
    const plan = await getPlan(user.plan);
    const routeContext: RouteContext = { userId: user.id, userPlan: user.plan, isAdmin: isPlatformAdmin(user.role), persona: user.personaId, organizationId: orgId, organizationRole: ws.role };
    const rc = { session: access.session, userId: user.id, organizationId: orgId, planSlug: user.plan, plan, routeContext, signal: req.signal };

    if (decision === 'REJECTED') {
      await decideApproval({ approvalId: approval.id, decidedByUserId: user.id, decision: 'REJECTED', organizationId: orgId });
      await logSecurityEvent({ event: 'agent.approval_rejected', userId: user.id, actorUserId: user.id, organizationId: orgId, metadata: { toolId: approval.toolId } });
      // Tell the agent it was rejected; it may adjust or stop (never re-asked in a loop).
      await addStep({ agentSessionId: access.session.id, stepIndex: access.session.stepsUsed, stepType: 'NOTE', status: 'SUCCEEDED', outputSummary: `You rejected the action ${approval.toolId}. Do not attempt it again; adjust or finish.` });
      const result = await advanceAgentSession({ ...rc, session: (await getSession(access.session.id))! });
      return NextResponse.json(result);
    }

    // decision === 'APPROVED'
    if (editedArguments) {
      // Edit path: void the old approval, build a NEW action bound to edited args.
      const tool = getAgentTool(approval.toolId);
      if (!tool) return badRequest('Unknown tool.');
      const oldAction = await getAction(approval.actionId);
      const normalized = normalizeArguments(tool, editedArguments); // throws on invalid → 400
      const hash = hashArguments(tool.id, normalized);
      const idem = idempotencyKey(access.session.id, tool.id, hash);
      await expireApproval(approval.id);
      if (oldAction) await updateAction(oldAction.id, { status: 'CANCELED', completedAt: new Date() });
      const newAction = await createAction({ agentSessionId: access.session.id, toolId: tool.id, connectionId: oldAction?.connectionId ?? null, riskLevel: tool.risk, reversibility: tool.reversibility, approvalStatus: 'AWAITING_APPROVAL', normalizedArguments: normalized, argumentsHash: hash, status: 'PROPOSED', idempotencyKey: idem });
      const preview = buildActionPreview(tool, normalized, true);
      const fresh = await createApproval({ actionId: newAction.id, agentSessionId: access.session.id, userId: user.id, organizationId: orgId, toolId: tool.id, riskLevel: tool.risk, argumentsHash: hash, preview });
      await decideApproval({ approvalId: fresh.id, decidedByUserId: user.id, decision: 'APPROVED', organizationId: orgId });
      await logSecurityEvent({ event: 'agent.approval_approved', userId: user.id, actorUserId: user.id, organizationId: orgId, metadata: { toolId: tool.id, edited: true } });
      const approvedAction = (await getAction(newAction.id))!;
      const consumedApproval = (await getApproval(fresh.id))!;
      const result = await resumeAfterApproval(rc, approvedAction, consumedApproval);
      return NextResponse.json(result);
    }

    await decideApproval({ approvalId: approval.id, decidedByUserId: user.id, decision: 'APPROVED', organizationId: orgId });
    await logSecurityEvent({ event: 'agent.approval_approved', userId: user.id, actorUserId: user.id, organizationId: orgId, metadata: { toolId: approval.toolId } });
    const action = (await getAction(approval.actionId))!;
    const result = await resumeAfterApproval(rc, action, approval);
    return NextResponse.json(result);
  } catch (err) {
    return handleError(err, 'agent.approvals.decide');
  }
}
