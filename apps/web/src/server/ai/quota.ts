import type { Plan } from '@/server/db/schema';

/**
 * Quota evaluation — PURE. Given a plan, the user's current usage aggregates,
 * and "now", decide whether a new request is allowed. Reset times are computed
 * from `now` (UTC). The DB aggregation lives in the ledger; this stays testable.
 */

export interface UsageAggregate {
  dayRequests: number;
  dayTokens: number;
  monthRequests: number;
  monthTokens: number;
  lastMinuteRequests: number;
}

export type QuotaReason =
  | 'RATE_LIMIT'
  | 'DAILY_REQUESTS'
  | 'DAILY_TOKENS'
  | 'MONTHLY_REQUESTS'
  | 'MONTHLY_TOKENS';

export interface QuotaDecision {
  allowed: boolean;
  reason?: QuotaReason;
  resetAt?: string; // ISO
  remainingRequests?: number | null; // null = unlimited
  remainingTokens?: number | null;
}

function nextMinute(now: Date): Date {
  const d = new Date(now);
  d.setUTCSeconds(0, 0);
  d.setUTCMinutes(d.getUTCMinutes() + 1);
  return d;
}
function nextUtcMidnight(now: Date): Date {
  const d = new Date(now);
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() + 1);
  return d;
}
function nextUtcMonth(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1, 0, 0, 0, 0));
}

const remaining = (limit: number | null, used: number): number | null =>
  limit == null ? null : Math.max(0, limit - used);

export function evaluateQuota(plan: Plan, agg: UsageAggregate, now: Date): QuotaDecision {
  // Rate limit (per minute) first — cheapest signal.
  if (plan.requestsPerMinute != null && agg.lastMinuteRequests >= plan.requestsPerMinute) {
    return { allowed: false, reason: 'RATE_LIMIT', resetAt: nextMinute(now).toISOString() };
  }
  if (plan.dailyRequestLimit != null && agg.dayRequests >= plan.dailyRequestLimit) {
    return { allowed: false, reason: 'DAILY_REQUESTS', resetAt: nextUtcMidnight(now).toISOString() };
  }
  if (plan.dailyTokenLimit != null && agg.dayTokens >= plan.dailyTokenLimit) {
    return { allowed: false, reason: 'DAILY_TOKENS', resetAt: nextUtcMidnight(now).toISOString() };
  }
  if (plan.monthlyRequestLimit != null && agg.monthRequests >= plan.monthlyRequestLimit) {
    return { allowed: false, reason: 'MONTHLY_REQUESTS', resetAt: nextUtcMonth(now).toISOString() };
  }
  if (plan.monthlyTokenLimit != null && agg.monthTokens >= plan.monthlyTokenLimit) {
    return { allowed: false, reason: 'MONTHLY_TOKENS', resetAt: nextUtcMonth(now).toISOString() };
  }

  return {
    allowed: true,
    remainingRequests: remaining(plan.monthlyRequestLimit ?? plan.dailyRequestLimit, plan.monthlyRequestLimit != null ? agg.monthRequests : agg.dayRequests),
    remainingTokens: remaining(plan.monthlyTokenLimit ?? plan.dailyTokenLimit, plan.monthlyTokenLimit != null ? agg.monthTokens : agg.dayTokens),
    resetAt: nextUtcMonth(now).toISOString(),
  };
}
