import { and, eq, gte, inArray, sql } from 'drizzle-orm';
import { getDb } from '@/server/db';
import { webSearchRequests } from '@/server/db/schema';
import type { Plan } from '@/server/db/schema';
import { GatewayError } from '@biina/ai-gateway';

/** Web-search quota — reuses the plan/quota model. Failed searches don't count. */
export async function webSearchUsage(userId: string, now: Date): Promise<{ day: number; month: number }> {
  const db = getDb();
  const day = new Date(now); day.setUTCHours(0, 0, 0, 0);
  const month = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const counted = inArray(webSearchRequests.status, ['ok', 'no_results']);
  const count = async (since: Date) => {
    const [row] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(webSearchRequests)
      .where(and(eq(webSearchRequests.userId, userId), counted, gte(webSearchRequests.createdAt, since)));
    return row?.n ?? 0;
  };
  const [d, m] = await Promise.all([count(day), count(month)]);
  return { day: d, month: m };
}

/** Throw a typed quota error if the plan's web-search allowance is exhausted. */
export function assertWebSearchQuota(plan: Pick<Plan, 'dailyWebSearches' | 'monthlyWebSearches'>, usage: { day: number; month: number }): void {
  if (plan.dailyWebSearches != null && usage.day >= plan.dailyWebSearches) {
    throw new GatewayError('quota_exceeded', 'Daily web-search limit reached', undefined, { data: { scope: 'day' } });
  }
  if (plan.monthlyWebSearches != null && usage.month >= plan.monthlyWebSearches) {
    throw new GatewayError('quota_exceeded', 'Monthly web-search limit reached', undefined, { data: { scope: 'month' } });
  }
}
