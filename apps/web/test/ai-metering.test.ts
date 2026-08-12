import { describe, it, expect, beforeEach } from 'vitest';
import type { Plan } from '@/server/db/schema';
import { estimateCost } from '@/server/ai/cost';
import {
  canUseModel,
  canUseWorkload,
  canUsePersona,
  effectiveMaxOutputTokens,
  estimateContextTokens,
} from '@/server/ai/entitlements';
import { evaluateQuota } from '@/server/ai/quota';
import { evaluateBudget } from '@/server/ai/budget';
import { acquireSlot, releaseSlot, activeCount } from '@/server/ai/concurrency';

function plan(over: Partial<Plan> = {}): Plan {
  return {
    slug: 'FREE',
    displayName: 'Free',
    enabled: true,
    dailyRequestLimit: null,
    monthlyRequestLimit: null,
    dailyTokenLimit: null,
    monthlyTokenLimit: null,
    requestsPerMinute: null,
    maxConcurrent: null,
    maxContextTokens: null,
    maxOutputTokens: null,
    allowedModels: [],
    allowedWorkloads: [],
    allowedPersonas: [],
    filesEligible: false,
    toolsEligible: false,
    webSearchEligible: false,
    priorityClass: 100,
    updatedAt: new Date(0),
    ...over,
  } as Plan;
}

const NOW = new Date('2026-08-12T10:30:00.000Z');

describe('cost estimation', () => {
  it('computes token-based cost', () => {
    const c = estimateCost({ inputCostPerMillion: 0.2, outputCostPerMillion: 0.6 }, { inputTokens: 1_000_000, outputTokens: 500_000 });
    expect(c.source).toBe('token');
    expect(c.inputCost).toBeCloseTo(0.2, 6);
    expect(c.outputCost).toBeCloseTo(0.3, 6);
    expect(c.totalCost).toBeCloseTo(0.5, 6);
  });

  it('adds a fixed request cost', () => {
    const c = estimateCost({ inputCostPerMillion: 0, outputCostPerMillion: 0, fixedRequestCost: 0.01 }, { inputTokens: 0, outputTokens: 0 });
    expect(c.totalCost).toBeCloseTo(0.01, 6);
  });

  it('does not invent numbers when tokens are missing', () => {
    const c = estimateCost({ inputCostPerMillion: 0.2, outputCostPerMillion: 0.6 }, { inputTokens: null, outputTokens: null });
    expect(c.inputCost).toBeNull();
    expect(c.outputCost).toBeNull();
    expect(c.totalCost).toBeNull();
  });

  it('returns class-only when no numeric pricing', () => {
    expect(estimateCost({ costClass: 'LOW' }, { inputTokens: 100 }).source).toBe('class');
    expect(estimateCost(undefined, {}).source).toBe('none');
  });
});

describe('entitlements', () => {
  it('empty allow-lists permit everything; non-empty restrict', () => {
    expect(canUseModel(plan(), 'biina')).toBe(true);
    expect(canUseModel(plan({ allowedModels: ['biina-fast'] }), 'biina')).toBe(false);
    expect(canUseWorkload(plan({ allowedWorkloads: ['fast-chat'] }), 'reasoning')).toBe(false);
    expect(canUsePersona(plan({ allowedPersonas: ['default'] }), 'kids')).toBe(false);
    expect(canUsePersona(plan(), null)).toBe(true);
  });

  it('effective output cap is the smaller of plan and model limits', () => {
    expect(effectiveMaxOutputTokens(plan({ maxOutputTokens: 2048 }), 4096)).toBe(2048);
    expect(effectiveMaxOutputTokens(plan({ maxOutputTokens: null }), 4096)).toBe(4096);
    expect(effectiveMaxOutputTokens(plan({ maxOutputTokens: null }), null)).toBeUndefined();
  });

  it('estimates context tokens (~4 chars/token)', () => {
    expect(estimateContextTokens([{ content: 'a'.repeat(400) }])).toBe(100);
  });
});

describe('quota evaluation', () => {
  const agg = { dayRequests: 0, dayTokens: 0, monthRequests: 0, monthTokens: 0, lastMinuteRequests: 0 };

  it('allows a user below all limits', () => {
    const d = evaluateQuota(plan({ dailyRequestLimit: 50, monthlyTokenLimit: 1000 }), agg, NOW);
    expect(d.allowed).toBe(true);
  });

  it('blocks on rate limit (per minute) first', () => {
    const d = evaluateQuota(plan({ requestsPerMinute: 5 }), { ...agg, lastMinuteRequests: 5 }, NOW);
    expect(d.allowed).toBe(false);
    expect(d.reason).toBe('RATE_LIMIT');
    expect(new Date(d.resetAt!).getUTCMinutes()).toBe(31);
  });

  it('blocks on daily request limit and resets at next UTC midnight', () => {
    const d = evaluateQuota(plan({ dailyRequestLimit: 50 }), { ...agg, dayRequests: 50 }, NOW);
    expect(d.reason).toBe('DAILY_REQUESTS');
    expect(d.resetAt).toBe('2026-08-13T00:00:00.000Z');
  });

  it('blocks on monthly tokens and resets at next month', () => {
    const d = evaluateQuota(plan({ monthlyTokenLimit: 1000 }), { ...agg, monthTokens: 1000 }, NOW);
    expect(d.reason).toBe('MONTHLY_TOKENS');
    expect(d.resetAt).toBe('2026-09-01T00:00:00.000Z');
  });

  it('treats null limits as unlimited', () => {
    const d = evaluateQuota(plan(), { dayRequests: 1e9, dayTokens: 1e9, monthRequests: 1e9, monthTokens: 1e9, lastMinuteRequests: 1e9 }, NOW);
    expect(d.allowed).toBe(true);
  });
});

describe('budget evaluation', () => {
  const t = {
    currency: 'USD',
    dailyCostWarn: null,
    dailyCostHardLimit: null,
    monthlyCostWarn: 80,
    monthlyCostHardLimit: 100,
    hardLimitEnabled: false,
  };

  it('normal below thresholds', () => {
    expect(evaluateBudget({ day: 0, month: 10 }, t).status).toBe('normal');
  });
  it('warning at/over the soft threshold', () => {
    expect(evaluateBudget({ day: 0, month: 85 }, t).status).toBe('warning');
  });
  it('critical at/over hard limit but NOT blocked when enforcement is off', () => {
    const d = evaluateBudget({ day: 0, month: 120 }, t);
    expect(d.status).toBe('critical');
    expect(d.blocked).toBe(false);
  });
  it('hard + blocked only when enforcement is enabled', () => {
    const d = evaluateBudget({ day: 0, month: 120 }, { ...t, hardLimitEnabled: true });
    expect(d.status).toBe('hard');
    expect(d.blocked).toBe(true);
  });
});

describe('concurrency limiter', () => {
  beforeEach(() => {
    // Clean any residue between tests.
    while (activeCount('u1') > 0) releaseSlot('u1');
  });

  it('enforces a max and releases slots', () => {
    expect(acquireSlot('u1', 2)).toBe(true);
    expect(acquireSlot('u1', 2)).toBe(true);
    expect(acquireSlot('u1', 2)).toBe(false); // at limit
    releaseSlot('u1');
    expect(acquireSlot('u1', 2)).toBe(true); // slot freed
  });

  it('treats null max as unlimited', () => {
    expect(acquireSlot('u2', null)).toBe(true);
    expect(acquireSlot('u2', null)).toBe(true);
    releaseSlot('u2');
    releaseSlot('u2');
  });
});
