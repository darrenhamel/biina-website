import { NextRequest } from 'next/server';
import { requireUser } from '@/server/auth/guards';
import { activeWorkspace } from '@/server/org/workspace';
import { getPlan } from '@/server/ai/plans';
import { startResearchSchema } from '@/lib/validation';
import { handleError, ok, forbidden } from '@/lib/api';
import { advancedResearchEnabled } from '@/server/research/config';
import { assertResearchQuota, resolveLimits } from '@/server/research/quotas';
import { createSession, listSessionsForScope } from '@/server/research/sessions';
import { planResearch, runResearch } from '@/server/research/orchestrator';

/**
 * POST /api/research — start advanced research. Plans first (bounded, acyclic);
 *   QUICK/STANDARD auto-start, DEEP is planned then requires an explicit /run so the
 *   user can review the plan before an expensive run.
 * GET  /api/research — list the caller's research runs in the active scope.
 */
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  const auth = await requireUser();
  if ('response' in auth) return auth.response;
  const user = auth.user;
  try {
    if (!advancedResearchEnabled()) return forbidden('Advanced research is disabled.');
    const input = startResearchSchema.parse(await req.json());
    const plan = await getPlan(user.plan);
    await assertResearchQuota(plan, user.id, input.depth); // 403/429 on entitlement/quota

    const ws = await activeWorkspace(req, user.id);
    if (ws.suspended) return forbidden('This workspace is unavailable.');
    const limits = resolveLimits(plan, input.depth);

    const session = await createSession({
      userId: user.id,
      organizationId: ws.organizationId,
      conversationId: null,
      objective: input.objective,
      depth: input.depth,
      maxTasks: limits.maxTasks,
      maxAgentRuns: limits.maxAgentRuns,
      maxSources: limits.maxSources,
      maxParallelAgents: limits.maxParallelAgents,
      maxCost: limits.maxCost,
      maxDurationMs: limits.maxDurationMs,
      knowledgeBaseIds: input.knowledgeBaseIds ?? [],
      connectionIds: input.connectionIds ?? [],
      webEnabled: input.webEnabled ?? true,
      deadlineAt: null,
    });

    const built = await planResearch(session, input.depth, plan);
    const autoStart = input.autoStart !== false && input.depth !== 'DEEP';
    if (autoStart) {
      const status = await runResearch(session, { plan, signal: req.signal });
      return ok({ sessionId: session.id, status, plan: { questions: built.questions, areas: built.areas } });
    }
    return ok({ sessionId: session.id, status: 'PLANNING', plan: { questions: built.questions, areas: built.areas, tasks: built.tasks.map((t) => ({ title: t.title, taskType: t.taskType, profile: t.profile })) } });
  } catch (err) {
    return handleError(err, 'research.start');
  }
}

export async function GET(req: NextRequest) {
  const auth = await requireUser();
  if ('response' in auth) return auth.response;
  try {
    const ws = await activeWorkspace(req, auth.user.id);
    const rows = await listSessionsForScope({ userId: auth.user.id, organizationId: ws.organizationId });
    return ok({ sessions: rows.map((s) => ({ id: s.id, objective: s.objective, status: s.status, depth: s.depth, sourcesCollected: s.sourcesCollected, tasksCompleted: s.tasksCompleted, createdAt: s.createdAt, completedAt: s.completedAt })) });
  } catch (err) {
    return handleError(err, 'research.list');
  }
}
