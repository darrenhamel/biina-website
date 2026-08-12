import { and, eq, gte, sql } from 'drizzle-orm';
import { getDb } from '@/server/db';
import { agentSessions } from '@/server/db/schema';
import type { Plan } from '@/server/db/schema';
import { GatewayError } from '@biina/ai-gateway';

/**
 * Agent entitlement + quota gate. Reuses the Phase 5 plan model: the agent is
 * plan-gated, and session starts are counted per day / month. Write-action and
 * external-message ceilings are enforced per-day from the connector usage ledger
 * during execution; this gate covers session admission.
 */

export async function assertAgentQuota(plan: Plan, userId: string, now = new Date()): Promise<void> {
  if (!plan.agentEnabled) throw new GatewayError('not_entitled', 'Your plan does not include the agent.');
  const day = new Date(now); day.setUTCHours(0, 0, 0, 0);
  const month = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const count = async (since: Date) => {
    const [r] = await getDb()
      .select({ n: sql<number>`count(*)::int` })
      .from(agentSessions)
      .where(and(eq(agentSessions.userId, userId), gte(agentSessions.createdAt, since)));
    return r?.n ?? 0;
  };
  if (plan.agentSessionsDailyLimit != null && (await count(day)) >= plan.agentSessionsDailyLimit) {
    throw new GatewayError('quota_exceeded', 'Daily agent-session limit reached', undefined, { data: { scope: 'day' } });
  }
  if (plan.agentSessionsMonthlyLimit != null && (await count(month)) >= plan.agentSessionsMonthlyLimit) {
    throw new GatewayError('quota_exceeded', 'Monthly agent-session limit reached', undefined, { data: { scope: 'month' } });
  }
}

/** Effective per-session step cap = min(plan cap, requested), defaulting sanely. */
export function effectiveMaxSteps(plan: Plan, requested?: number): number {
  const def = Number(process.env.AGENT_MAX_STEPS_DEFAULT) || 8;
  const planCap = plan.agentMaxStepsPerSession ?? def;
  const req = requested && requested > 0 ? requested : def;
  return Math.max(1, Math.min(planCap, req));
}

/** Runtime deadline for a run (ms from now). */
export function runDeadline(now = new Date()): Date {
  const ms = Number(process.env.AGENT_MAX_RUNTIME_MS) || 120_000;
  return new Date(now.getTime() + ms);
}
