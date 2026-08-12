import { and, desc, eq, gte, sql } from 'drizzle-orm';
import { getDb } from '@/server/db';
import { usageEvents, users } from '@/server/db/schema';
import type { NewUsageEvent } from '@/server/db/schema';
import type { UsageAggregate } from './quota';

/**
 * Usage ledger — persistence + aggregation. Writes are idempotent on requestId
 * (retries / duplicate deliveries never double-count). Aggregations use SQL so
 * dashboards never scan raw rows in app code. NO prompt/response content here.
 */

export function startOfUtcDay(now: Date): Date {
  const d = new Date(now);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}
export function startOfUtcMonth(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}
function minuteAgo(now: Date): Date {
  return new Date(now.getTime() - 60_000);
}

/** Idempotent write. Returns false if a row for this requestId already existed. */
export async function writeUsageEvent(event: NewUsageEvent): Promise<boolean> {
  const rows = await getDb()
    .insert(usageEvents)
    .values(event)
    .onConflictDoNothing({ target: usageEvents.requestId })
    .returning({ id: usageEvents.id });
  return rows.length > 0;
}

/** Quota aggregates for a user (only events that count against quota). */
export async function userUsageWindows(userId: string, now: Date): Promise<UsageAggregate> {
  const db = getDb();
  const day = startOfUtcDay(now);
  const month = startOfUtcMonth(now);
  const minute = minuteAgo(now);
  const counted = eq(usageEvents.countedAgainstQuota, true);

  const agg = async (since: Date) => {
    const [row] = await db
      .select({
        requests: sql<number>`count(*)::int`,
        tokens: sql<number>`coalesce(sum(${usageEvents.totalTokens}), 0)::int`,
      })
      .from(usageEvents)
      .where(and(eq(usageEvents.userId, userId), counted, gte(usageEvents.createdAt, since)));
    return { requests: row?.requests ?? 0, tokens: row?.tokens ?? 0 };
  };

  const [d, m, minuteRow] = await Promise.all([
    agg(day),
    agg(month),
    db
      .select({ requests: sql<number>`count(*)::int` })
      .from(usageEvents)
      .where(and(eq(usageEvents.userId, userId), gte(usageEvents.createdAt, minute))),
  ]);

  return {
    dayRequests: d.requests,
    dayTokens: d.tokens,
    monthRequests: m.requests,
    monthTokens: m.tokens,
    lastMinuteRequests: minuteRow[0]?.requests ?? 0,
  };
}

/** Platform-wide estimated spend (all events) for budget checks. */
export async function platformSpend(now: Date): Promise<{ day: number; month: number }> {
  const db = getDb();
  const spend = async (since: Date) => {
    const [row] = await db
      .select({ cost: sql<number>`coalesce(sum(${usageEvents.estimatedTotalCost}), 0)::float` })
      .from(usageEvents)
      .where(gte(usageEvents.createdAt, since));
    return row?.cost ?? 0;
  };
  const [day, month] = await Promise.all([spend(startOfUtcDay(now)), spend(startOfUtcMonth(now))]);
  return { day, month };
}

/** Admin summary tiles. */
export async function adminSummary(now: Date) {
  const db = getDb();
  const window = async (since: Date) => {
    const [row] = await db
      .select({
        requests: sql<number>`count(*)::int`,
        tokens: sql<number>`coalesce(sum(${usageEvents.totalTokens}), 0)::int`,
        cost: sql<number>`coalesce(sum(${usageEvents.estimatedTotalCost}), 0)::float`,
        failed: sql<number>`count(*) filter (where ${usageEvents.status} in ('error','timeout'))::int`,
        fallback: sql<number>`count(*) filter (where ${usageEvents.fallbackUsed})::int`,
        activeUsers: sql<number>`count(distinct ${usageEvents.userId})::int`,
      })
      .from(usageEvents)
      .where(gte(usageEvents.createdAt, since));
    return row;
  };
  const [day, month] = await Promise.all([window(startOfUtcDay(now)), window(startOfUtcMonth(now))]);
  return { day, month };
}

type BreakdownField = 'providerType' | 'biinaModelSlug' | 'plan' | 'persona' | 'workload';

/** Group month-to-date usage by a dimension. */
export async function breakdownBy(field: BreakdownField, now: Date) {
  const col = usageEvents[field];
  const rows = await getDb()
    .select({
      key: col,
      requests: sql<number>`count(*)::int`,
      tokens: sql<number>`coalesce(sum(${usageEvents.totalTokens}), 0)::int`,
      cost: sql<number>`coalesce(sum(${usageEvents.estimatedTotalCost}), 0)::float`,
    })
    .from(usageEvents)
    .where(gte(usageEvents.createdAt, startOfUtcMonth(now)))
    .groupBy(col)
    .orderBy(desc(sql`coalesce(sum(${usageEvents.estimatedTotalCost}), 0)`));
  return rows.map((r) => ({ key: r.key ?? '(none)', requests: r.requests, tokens: r.tokens, cost: r.cost }));
}

/** Highest-usage accounts this month (no conversation content). */
export async function topUsers(now: Date, limit = 10) {
  return getDb()
    .select({
      userId: usageEvents.userId,
      email: users.email,
      plan: users.plan,
      requests: sql<number>`count(*)::int`,
      tokens: sql<number>`coalesce(sum(${usageEvents.totalTokens}), 0)::int`,
      cost: sql<number>`coalesce(sum(${usageEvents.estimatedTotalCost}), 0)::float`,
    })
    .from(usageEvents)
    .leftJoin(users, eq(users.id, usageEvents.userId))
    .where(gte(usageEvents.createdAt, startOfUtcMonth(now)))
    .groupBy(usageEvents.userId, users.email, users.plan)
    .orderBy(desc(sql`coalesce(sum(${usageEvents.estimatedTotalCost}), 0)`))
    .limit(limit);
}

/** Per-model economics this month. */
export async function modelEconomics(now: Date) {
  const rows = await getDb()
    .select({
      model: usageEvents.biinaModelSlug,
      requests: sql<number>`count(*)::int`,
      avgTtft: sql<number>`coalesce(avg(${usageEvents.timeToFirstTokenMs}), 0)::int`,
      avgLatency: sql<number>`coalesce(avg(${usageEvents.totalLatencyMs}), 0)::int`,
      tokens: sql<number>`coalesce(sum(${usageEvents.totalTokens}), 0)::int`,
      cost: sql<number>`coalesce(sum(${usageEvents.estimatedTotalCost}), 0)::float`,
      failures: sql<number>`count(*) filter (where ${usageEvents.status} in ('error','timeout'))::int`,
    })
    .from(usageEvents)
    .where(gte(usageEvents.createdAt, startOfUtcMonth(now)))
    .groupBy(usageEvents.biinaModelSlug)
    .orderBy(desc(sql`coalesce(sum(${usageEvents.estimatedTotalCost}), 0)`));
  return rows.map((r) => ({
    model: r.model ?? '(none)',
    requests: r.requests,
    avgTtftMs: r.avgTtft,
    avgLatencyMs: r.avgLatency,
    tokens: r.tokens,
    cost: r.cost,
    failureRate: r.requests ? Math.round((r.failures / r.requests) * 100) : 0,
    costPerRequest: r.requests ? r.cost / r.requests : 0,
  }));
}
