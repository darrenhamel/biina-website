import { and, eq, gte, sql, inArray } from 'drizzle-orm';
import { getDb } from '@/server/db';
import { subscriptions, commercialPrices, usageEvents, users } from '@/server/db/schema';
import type { SubscriptionStatus } from '@/server/db/schema';

/**
 * Billing analytics — operational, explicitly ESTIMATED (not accounting-grade).
 *
 * MRR normalizes annual → monthly and is reported PER CURRENCY: mixed currencies
 * are never summed without an FX strategy. Unit economics pairs subscription
 * revenue (from our commercial prices) with estimated AI cost (usage ledger).
 */

const REVENUE_STATUSES: SubscriptionStatus[] = ['ACTIVE', 'TRIALING', 'PAST_DUE'];

/** Monthly-normalized minor-unit amount for a price. */
export function monthlyAmount(amount: number, interval: 'month' | 'year', intervalCount: number): number {
  const perInterval = amount / Math.max(1, intervalCount);
  return interval === 'year' ? perInterval / 12 : perInterval;
}

export async function subscriptionCounts() {
  const rows = await getDb()
    .select({ status: subscriptions.status, n: sql<number>`count(*)::int` })
    .from(subscriptions)
    .groupBy(subscriptions.status);
  const by = Object.fromEntries(rows.map((r) => [r.status, r.n]));
  return {
    active: by['ACTIVE'] ?? 0,
    trialing: by['TRIALING'] ?? 0,
    pastDue: by['PAST_DUE'] ?? 0,
    canceled: by['CANCELED'] ?? 0,
    unpaid: by['UNPAID'] ?? 0,
    total: rows.reduce((s, r) => s + r.n, 0),
  };
}

/** MRR + ARR per currency (minor units). Recurring subscriptions only. */
export async function mrrByCurrency() {
  const rows = await getDb()
    .select({
      currency: commercialPrices.currency,
      amount: commercialPrices.amount,
      interval: commercialPrices.billingInterval,
      intervalCount: commercialPrices.billingIntervalCount,
    })
    .from(subscriptions)
    .innerJoin(commercialPrices, eq(commercialPrices.id, subscriptions.commercialPriceId))
    .where(inArray(subscriptions.status, REVENUE_STATUSES));

  const byCurrency = new Map<string, number>();
  for (const r of rows) {
    const m = monthlyAmount(r.amount, r.interval as 'month' | 'year', r.intervalCount);
    byCurrency.set(r.currency, (byCurrency.get(r.currency) ?? 0) + m);
  }
  return Array.from(byCurrency.entries()).map(([currency, mrr]) => ({
    currency,
    mrr: Math.round(mrr),
    arr: Math.round(mrr * 12),
  }));
}

export async function recentBillingChanges(now: Date) {
  const db = getDb();
  const since = new Date(now.getTime() - 30 * 86_400_000);
  const [created] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(subscriptions)
    .where(gte(subscriptions.createdAt, since));
  const [canceled] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(subscriptions)
    .where(and(eq(subscriptions.status, 'CANCELED'), gte(subscriptions.updatedAt, since)));
  return { newSubscriptions30d: created?.n ?? 0, cancellations30d: canceled?.n ?? 0 };
}

/**
 * Per-plan unit economics (estimate). Subscription revenue is per currency;
 * AI cost is the usage ledger's estimated cost (USD) this month. Currencies are
 * NOT converted — the UI must label this clearly.
 */
export async function planUnitEconomics(now: Date) {
  const db = getDb();
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));

  // Revenue side: active subs grouped by plan + currency.
  const revRows = await db
    .select({
      planSlug: subscriptions.planSlug,
      currency: commercialPrices.currency,
      amount: commercialPrices.amount,
      interval: commercialPrices.billingInterval,
      intervalCount: commercialPrices.billingIntervalCount,
    })
    .from(subscriptions)
    .innerJoin(commercialPrices, eq(commercialPrices.id, subscriptions.commercialPriceId))
    .where(inArray(subscriptions.status, REVENUE_STATUSES));

  type PlanAgg = { subscribers: number; revenueByCurrency: Record<string, number>; aiCostUsd: number };
  const plans = new Map<string, PlanAgg>();
  const ensure = (slug: string): PlanAgg => {
    if (!plans.has(slug)) plans.set(slug, { subscribers: 0, revenueByCurrency: {}, aiCostUsd: 0 });
    return plans.get(slug)!;
  };
  for (const r of revRows) {
    const p = ensure(r.planSlug);
    p.subscribers += 1;
    const m = Math.round(monthlyAmount(r.amount, r.interval as 'month' | 'year', r.intervalCount));
    p.revenueByCurrency[r.currency] = (p.revenueByCurrency[r.currency] ?? 0) + m;
  }

  // AI cost side: month-to-date estimated cost grouped by the user's current plan.
  const costRows = await db
    .select({ plan: users.plan, cost: sql<number>`coalesce(sum(${usageEvents.estimatedTotalCost}),0)::float` })
    .from(usageEvents)
    .innerJoin(users, eq(users.id, usageEvents.userId))
    .where(gte(usageEvents.createdAt, monthStart))
    .groupBy(users.plan);
  for (const r of costRows) ensure(r.plan as string).aiCostUsd = r.cost;

  return Array.from(plans.entries()).map(([planSlug, p]) => ({
    planSlug,
    subscribers: p.subscribers,
    revenueByCurrency: p.revenueByCurrency,
    aiCostUsdMonth: Math.round(p.aiCostUsd * 100) / 100,
  }));
}

/** Free-user infrastructure cost (estimated, month-to-date). CAC control. */
export async function freeUserAiCost(now: Date) {
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const [row] = await getDb()
    .select({
      users: sql<number>`count(distinct ${usageEvents.userId})::int`,
      cost: sql<number>`coalesce(sum(${usageEvents.estimatedTotalCost}),0)::float`,
    })
    .from(usageEvents)
    .innerJoin(users, eq(users.id, usageEvents.userId))
    .where(and(gte(usageEvents.createdAt, monthStart), eq(users.plan, 'FREE')));
  return { freeUsers: row?.users ?? 0, aiCostUsdMonth: Math.round((row?.cost ?? 0) * 100) / 100 };
}

/** Reconciliation: compare our subscriptions to provider state (admin/dev). */
export async function reconcileSubscriptions(limit = 100) {
  const { getPaymentProvider } = await import('./index');
  const { upsertSubscriptionFromProvider } = await import('./service');
  const provider = getPaymentProvider();
  const rows = await getDb()
    .select({ id: subscriptions.id, providerSubscriptionId: subscriptions.providerSubscriptionId, status: subscriptions.status })
    .from(subscriptions)
    .limit(limit);
  const drift: Array<{ id: string; localStatus: string; providerStatus: string }> = [];
  for (const r of rows) {
    try {
      const n = await provider.retrieveSubscription(r.providerSubscriptionId);
      if (n.status !== r.status) {
        drift.push({ id: r.id, localStatus: r.status, providerStatus: n.status });
        await upsertSubscriptionFromProvider(n); // heal
      }
    } catch {
      /* provider unreachable for this row — skip, report count only */
    }
  }
  return { checked: rows.length, drift };
}
