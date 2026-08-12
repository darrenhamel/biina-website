/**
 * Budget evaluation — PURE. Compares current spend to configured thresholds and
 * returns a status. A HARD limit blocks new billable requests ONLY when
 * explicitly enabled; soft thresholds only warn. Admins are never blocked (the
 * control plane stays reachable) — enforcement happens on the AI request path.
 */

export interface BudgetThresholds {
  currency: string;
  dailyCostWarn: number | null;
  dailyCostHardLimit: number | null;
  monthlyCostWarn: number | null;
  monthlyCostHardLimit: number | null;
  hardLimitEnabled: boolean;
}

export interface Spend {
  day: number;
  month: number;
}

export type BudgetStatus = 'normal' | 'warning' | 'critical' | 'hard';

export interface BudgetDecision {
  status: BudgetStatus;
  blocked: boolean;
  dayPct: number | null; // % of daily hard limit (or warn if no hard limit)
  monthPct: number | null;
  currency: string;
}

function pct(used: number, limit: number | null): number | null {
  if (limit == null || limit <= 0) return null;
  return Math.round((used / limit) * 100);
}

export function evaluateBudget(spend: Spend, t: BudgetThresholds): BudgetDecision {
  const dayHardHit = t.dailyCostHardLimit != null && spend.day >= t.dailyCostHardLimit;
  const monthHardHit = t.monthlyCostHardLimit != null && spend.month >= t.monthlyCostHardLimit;
  const blocked = t.hardLimitEnabled && (dayHardHit || monthHardHit);

  const dayWarnHit = t.dailyCostWarn != null && spend.day >= t.dailyCostWarn;
  const monthWarnHit = t.monthlyCostWarn != null && spend.month >= t.monthlyCostWarn;

  let status: BudgetStatus = 'normal';
  if (blocked) status = 'hard';
  else if (dayHardHit || monthHardHit) status = 'critical'; // at/over hard limit but enforcement off
  else if (dayWarnHit || monthWarnHit) status = 'warning';

  return {
    status,
    blocked,
    dayPct: pct(spend.day, t.dailyCostHardLimit ?? t.dailyCostWarn),
    monthPct: pct(spend.month, t.monthlyCostHardLimit ?? t.monthlyCostWarn),
    currency: t.currency,
  };
}
