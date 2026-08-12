import { NextRequest, NextResponse } from 'next/server';
import { requireUser } from '@/server/auth/guards';
import { isPlatformAdmin } from '@/server/auth/permissions';
import { activeWorkspace } from '@/server/org/workspace';
import { getPlan } from '@/server/ai/plans';
import type { RouteContext } from '@/server/ai/routing';
import { startAgentSchema } from '@/lib/validation';
import { handleError, forbidden, ok } from '@/lib/api';
import { logSecurityEvent } from '@/server/auth/events';
import { assertAgentQuota, effectiveMaxSteps, runDeadline } from '@/server/agent/quotas';
import { resolveEffectivePolicy } from '@/server/agent/policies-store';
import { agentExecutionEnabled } from '@/server/agent/risk';
import { createSession, listSessionsForScope } from '@/server/agent/sessions';
import { advanceAgentSession } from '@/server/agent/orchestrator';

/**
 * POST /api/agent/sessions — start a bounded, human-supervised agent run.
 * GET  /api/agent/sessions — list the caller's recent runs in the active scope.
 *
 * The run is plan-gated + quota-checked + kill-switched. AGENT mode is never the
 * default (schema default is ASSISTED). All privileged context (plan, org, role)
 * is derived from the session — never from the body.
 */
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  const auth = await requireUser();
  if ('response' in auth) return auth.response;
  const user = auth.user;
  try {
    if (!agentExecutionEnabled()) return forbidden('The agent is currently disabled.');
    const { goal, mode, conversationId, maxSteps, dryRun } = startAgentSchema.parse(await req.json());

    const ws = await activeWorkspace(req, user.id);
    if (ws.suspended) return forbidden('This workspace is unavailable.');
    const orgId = ws.organizationId;

    const plan = await getPlan(user.plan);
    await assertAgentQuota(plan, user.id); // throws → handled below (403/429)

    const policy = await resolveEffectivePolicy({ userId: user.id, organizationId: orgId });
    if (!policy.agentEnabled) return forbidden('The agent is disabled by policy for your account.');

    const session = await createSession({
      userId: user.id,
      organizationId: orgId,
      conversationId: conversationId ?? null,
      mode,
      goal,
      maxSteps: effectiveMaxSteps(plan, maxSteps),
      costBudget: null,
      currency: 'USD',
      dryRun: Boolean(dryRun),
      deadlineAt: runDeadline(),
    });
    await logSecurityEvent({ event: 'agent.session_started', userId: user.id, actorUserId: user.id, organizationId: orgId, metadata: { sessionId: session.id, mode, dryRun: Boolean(dryRun) } });

    const routeContext: RouteContext = {
      userId: user.id,
      userPlan: user.plan,
      isAdmin: isPlatformAdmin(user.role),
      persona: user.personaId,
      organizationId: orgId,
      organizationRole: ws.role,
    };

    const result = await advanceAgentSession({ session, userId: user.id, organizationId: orgId, planSlug: user.plan, plan, routeContext, signal: req.signal });
    return NextResponse.json({ sessionId: session.id, ...result });
  } catch (err) {
    return handleError(err, 'agent.sessions.start');
  }
}

export async function GET(req: NextRequest) {
  const auth = await requireUser();
  if ('response' in auth) return auth.response;
  try {
    const ws = await activeWorkspace(req, auth.user.id);
    const rows = await listSessionsForScope({ userId: auth.user.id, organizationId: ws.organizationId });
    return ok({
      sessions: rows.map((s) => ({ id: s.id, status: s.status, mode: s.mode, goal: s.goal, stepsUsed: s.stepsUsed, writeActionsUsed: s.writeActionsUsed, createdAt: s.createdAt, completedAt: s.completedAt })),
    });
  } catch (err) {
    return handleError(err, 'agent.sessions.list');
  }
}
