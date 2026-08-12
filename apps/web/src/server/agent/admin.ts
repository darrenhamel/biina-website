import { and, desc, eq, gte, sql } from 'drizzle-orm';
import { getDb } from '@/server/db';
import { agentSessions, agentActions } from '@/server/db/schema';
import type { AgentPolicy } from '@/server/db/schema';
import { writeAudit } from '@/server/ai/audit';
import { logSecurityEvent } from '@/server/auth/events';
import { upsertAgentPolicy, resolveEffectivePolicy } from './policies-store';

/**
 * Agent admin/observability. Returns OPERATIONAL metadata only — never private
 * content, arguments, or tokens. Platform admins see the whole platform; org
 * managers see only their org's agent activity.
 */

export async function agentAdminOverview(scope: { organizationId?: string | null } = {}): Promise<{
  sessions: { total: number; completed: number; failed: number; blocked: number; awaitingApproval: number; active: number };
  actions: { total: number; succeeded: number; blocked: number; rejected: number; unknownOutcome: number; writes: number };
  avgSteps: number;
  estimatedCost: number;
  topTools: Array<{ toolId: string; count: number }>;
  recent: Array<{ id: string; status: string; mode: string; goal: string; stepsUsed: number; createdAt: string }>;
}> {
  const db = getDb();
  const since = new Date(Date.now() - 30 * 24 * 60 * 60_000);
  const orgFilter = scope.organizationId ? eq(agentSessions.organizationId, scope.organizationId) : undefined;
  const sWhere = orgFilter ? and(gte(agentSessions.createdAt, since), orgFilter) : gte(agentSessions.createdAt, since);

  const [sessionRows, actionRows, recentRows, toolRows] = await Promise.all([
    db.select({ status: agentSessions.status, steps: agentSessions.stepsUsed, cost: agentSessions.estimatedCost }).from(agentSessions).where(sWhere),
    db
      .select({ status: agentActions.status, risk: agentActions.riskLevel })
      .from(agentActions)
      .innerJoin(agentSessions, eq(agentActions.agentSessionId, agentSessions.id))
      .where(sWhere),
    db.select({ id: agentSessions.id, status: agentSessions.status, mode: agentSessions.mode, goal: agentSessions.goal, steps: agentSessions.stepsUsed, createdAt: agentSessions.createdAt }).from(agentSessions).where(sWhere).orderBy(desc(agentSessions.createdAt)).limit(20),
    db
      .select({ toolId: agentActions.toolId, count: sql<number>`count(*)::int` })
      .from(agentActions)
      .innerJoin(agentSessions, eq(agentActions.agentSessionId, agentSessions.id))
      .where(sWhere)
      .groupBy(agentActions.toolId)
      .orderBy(desc(sql`count(*)`))
      .limit(8),
  ]);

  const sessions = {
    total: sessionRows.length,
    completed: sessionRows.filter((s) => s.status === 'COMPLETED').length,
    failed: sessionRows.filter((s) => s.status === 'FAILED').length,
    blocked: sessionRows.filter((s) => s.status === 'BLOCKED').length,
    awaitingApproval: sessionRows.filter((s) => s.status === 'AWAITING_APPROVAL').length,
    active: sessionRows.filter((s) => s.status === 'RUNNING' || s.status === 'PENDING').length,
  };
  const actions = {
    total: actionRows.length,
    succeeded: actionRows.filter((a) => a.status === 'SUCCEEDED').length,
    blocked: actionRows.filter((a) => a.status === 'BLOCKED').length,
    rejected: actionRows.filter((a) => a.status === 'REJECTED').length,
    unknownOutcome: actionRows.filter((a) => a.status === 'UNKNOWN_OUTCOME').length,
    writes: actionRows.filter((a) => a.risk !== 'READ_ONLY').length,
  };
  const avgSteps = sessionRows.length ? Math.round((sessionRows.reduce((n, s) => n + s.steps, 0) / sessionRows.length) * 10) / 10 : 0;
  const estimatedCost = Math.round(sessionRows.reduce((n, s) => n + Number(s.cost ?? 0), 0) * 10000) / 10000;

  return {
    sessions,
    actions,
    avgSteps,
    estimatedCost,
    topTools: toolRows.map((t) => ({ toolId: t.toolId, count: t.count })),
    recent: recentRows.map((r) => ({ id: r.id, status: r.status, mode: r.mode, goal: r.goal.slice(0, 120), stepsUsed: r.steps, createdAt: r.createdAt.toISOString() })),
  };
}

/** Set a policy at a scope + audit it. Stricter-than-default only (never loosens safety). */
export async function setAgentPolicy(input: {
  scope: 'PLATFORM' | 'ORGANIZATION' | 'USER';
  scopeId: string | null;
  updatedByUserId: string;
  patch: Partial<Omit<AgentPolicy, 'id' | 'scope' | 'scopeId' | 'createdAt' | 'updatedAt'>>;
}): Promise<void> {
  await upsertAgentPolicy(input);
  await writeAudit({ adminUserId: input.updatedByUserId, action: 'agent.policy.update', targetType: 'agent_policy', targetId: `${input.scope}:${input.scopeId ?? 'platform'}`, newValue: input.patch as Record<string, unknown> });
  await logSecurityEvent({ event: 'agent.policy_changed', userId: input.updatedByUserId, actorUserId: input.updatedByUserId, organizationId: input.scope === 'ORGANIZATION' ? input.scopeId : null, metadata: { scope: input.scope } });
}

export { resolveEffectivePolicy };
