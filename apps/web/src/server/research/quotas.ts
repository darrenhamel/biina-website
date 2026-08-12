import { and, eq, gte, sql } from 'drizzle-orm';
import { getDb } from '@/server/db';
import { researchSessions } from '@/server/db/schema';
import type { Plan } from '@/server/db/schema';
import { GatewayError } from '@biina/ai-gateway';
import { depthBudget, type Depth } from './config';

/**
 * Research entitlement + quota gate + EFFECTIVE-LIMIT resolution. Effective limits
 * are the MOST restrictive of platform ceilings, plan entitlements, and the depth
 * budget — never the requested value alone, and never anything a model/source asked.
 */

export interface EffectiveLimits {
  maxTasks: number;
  maxAgentRuns: number;
  maxSources: number;
  maxParallelAgents: number;
  maxCost: number | null;
  maxDurationMs: number;
}

export function resolveLimits(plan: Plan, depth: Depth): EffectiveLimits {
  const b = depthBudget(depth);
  return {
    maxTasks: Math.min(b.maxTasks, plan.maxResearchTasks ?? b.maxTasks),
    maxAgentRuns: b.maxAgentRuns,
    maxSources: Math.min(b.maxSources, plan.maxSourcesPerResearch ?? b.maxSources),
    maxParallelAgents: Math.min(b.maxParallelAgents, plan.maxParallelAgents ?? b.maxParallelAgents),
    maxCost: plan.maxResearchCost ?? null,
    maxDurationMs: b.maxDurationMs,
  };
}

export async function assertResearchQuota(plan: Plan, userId: string, depth: Depth): Promise<void> {
  if (!plan.advancedResearchEnabled) throw new GatewayError('not_entitled', 'Your plan does not include advanced research.');
  if (depth === 'DEEP' && !plan.deepResearchEnabled) throw new GatewayError('not_entitled', 'Your plan does not include deep research.');
  if (plan.researchRunsPerMonth != null) {
    const month = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1));
    const [r] = await getDb().select({ n: sql<number>`count(*)::int` }).from(researchSessions).where(and(eq(researchSessions.userId, userId), gte(researchSessions.createdAt, month)));
    if ((r?.n ?? 0) >= plan.researchRunsPerMonth) throw new GatewayError('quota_exceeded', 'Monthly research limit reached', undefined, { data: { scope: 'month' } });
  }
}
