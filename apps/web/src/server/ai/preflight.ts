import { GatewayError } from '@biina/ai-gateway';
import type { AiModel, Plan } from '@/server/db/schema';
import { getPlan } from './plans';
import {
  canUseModel,
  canUseWorkload,
  canUsePersona,
  effectiveMaxOutputTokens,
  estimateContextTokens,
} from './entitlements';
import { evaluateQuota } from './quota';
import { evaluateBudget, type BudgetThresholds } from './budget';
import { acquireSlot, releaseSlot } from './concurrency';
import { userUsageWindows, platformSpend } from './ledger';
import type { AiConfigSnapshot } from './catalog';
import { modelBySlug } from './catalog';
import { logger } from '@/lib/logger';

/**
 * Pre-generation checks (server-side, before any provider call):
 *   entitlement → context size → budget (hard) → quota → concurrency
 *
 * Throws a typed GatewayError (not_entitled / context_too_large / budget_exceeded
 * / quota_exceeded / rate_limited) on rejection — the chat route maps these to a
 * safe status + message. On success returns the effective output cap and a
 * `release()` to free the concurrency slot.
 *
 * Metering can be disabled with USAGE_METERING_ENABLED=false (checks skipped).
 */

export function meteringEnabled(): boolean {
  return process.env.USAGE_METERING_ENABLED !== 'false';
}
export function budgetControlsEnabled(): boolean {
  return process.env.BUDGET_CONTROLS_ENABLED !== 'false';
}

export interface PreflightResult {
  planSlug: string;
  maxOutputTokens?: number;
  release: () => void;
}

export interface PreflightInput {
  userId: string;
  isAdmin: boolean;
  planSlug: string;
  persona?: string | null;
  workload?: string | null;
  biinaModelSlug: string;
  snapshot: AiConfigSnapshot;
  /** Raw conversation history (user/assistant), for context-size estimation. */
  messages: Array<{ content: string }>;
  now: Date;
}

export async function preflight(input: PreflightInput): Promise<PreflightResult> {
  const plan: Plan = await getPlan(input.planSlug);
  const model = modelBySlug(input.snapshot, input.biinaModelSlug);

  if (!meteringEnabled()) {
    return {
      planSlug: plan.slug,
      maxOutputTokens: effectiveMaxOutputTokens(plan, model?.maxOutputTokens),
      release: () => {},
    };
  }

  // 1. Entitlement.
  if (!canUseModel(plan, input.biinaModelSlug)) {
    throw new GatewayError('not_entitled', `plan ${plan.slug} may not use model ${input.biinaModelSlug}`);
  }
  if (!canUseWorkload(plan, input.workload)) {
    throw new GatewayError('not_entitled', `plan ${plan.slug} may not use workload ${input.workload}`);
  }
  if (!canUsePersona(plan, input.persona)) {
    throw new GatewayError('not_entitled', `plan ${plan.slug} may not use persona ${input.persona}`);
  }

  // 2. Context size.
  if (plan.maxContextTokens != null) {
    const ctxTokens = estimateContextTokens(input.messages);
    if (ctxTokens > plan.maxContextTokens) {
      throw new GatewayError('context_too_large', `context ${ctxTokens} > plan limit ${plan.maxContextTokens}`, undefined, {
        data: { maxContextTokens: plan.maxContextTokens },
      });
    }
  }

  // 3. Platform hard budget (admins are never blocked from the control plane, but
  //    AI requests are — including theirs — when the hard limit is on).
  if (budgetControlsEnabled()) {
    const t = budgetThresholds(input.snapshot);
    if (t.hardLimitEnabled) {
      const spend = await platformSpend(input.now);
      const b = evaluateBudget(spend, t);
      if (b.blocked) {
        logger.warn('ai.budget.blocked', { status: b.status, dayPct: b.dayPct, monthPct: b.monthPct });
        throw new GatewayError('budget_exceeded', 'platform hard budget limit reached');
      }
    }
  }

  // 4. Quota (per-user daily/monthly + rate/minute).
  const agg = await userUsageWindows(input.userId, input.now);
  const q = evaluateQuota(plan, agg, input.now);
  if (!q.allowed) {
    throw new GatewayError('quota_exceeded', `quota: ${q.reason}`, undefined, {
      data: { reason: q.reason, resetAt: q.resetAt },
    });
  }

  // 5. Concurrency (in-memory slot; released in the service `finally`).
  const ok = acquireSlot(input.userId, plan.maxConcurrent ?? null);
  if (!ok) {
    throw new GatewayError('rate_limited', 'too many concurrent generations', undefined, {
      data: { maxConcurrent: plan.maxConcurrent },
    });
  }

  return {
    planSlug: plan.slug,
    maxOutputTokens: effectiveMaxOutputTokens(plan, model?.maxOutputTokens),
    release: () => releaseSlot(input.userId),
  };
}

export function budgetThresholds(snap: AiConfigSnapshot): BudgetThresholds {
  const s = snap.settings;
  return {
    currency: s.currency,
    dailyCostWarn: s.dailyCostWarn,
    dailyCostHardLimit: s.dailyCostHardLimit,
    monthlyCostWarn: s.monthlyCostWarn,
    monthlyCostHardLimit: s.monthlyCostHardLimit,
    hardLimitEnabled: s.hardLimitEnabled,
  };
}

export type { AiModel };
