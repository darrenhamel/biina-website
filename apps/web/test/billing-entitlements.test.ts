import { describe, it, expect } from 'vitest';
import { decideEntitlement } from '@/server/billing/entitlements';
import { monthlyAmount } from '@/server/billing/analytics';

/**
 * Entitlements follow VERIFIED billing state. `decideEntitlement` is the pure
 * core: given a stored subscription it decides the entitlement conferred now.
 * These lock the grant/deny + grace + trial semantics.
 */

const base = {
  planSlug: 'PRO',
  cancelAtPeriodEnd: false,
  organizationId: null as string | null,
};
const now = new Date('2026-06-15T00:00:00Z');
const future = new Date('2026-07-15T00:00:00Z');
const past = new Date('2026-06-01T00:00:00Z');

describe('decideEntitlement', () => {
  it('ACTIVE grants the plan through the current period', () => {
    const d = decideEntitlement({ ...base, status: 'ACTIVE', currentPeriodEnd: future }, now);
    expect(d).toEqual({ planSlug: 'PRO', source: 'SUBSCRIPTION', endsAt: future });
  });

  it('TRIALING grants with a TRIAL source', () => {
    const d = decideEntitlement({ ...base, status: 'TRIALING', currentPeriodEnd: future }, now);
    expect(d?.source).toBe('TRIAL');
    expect(d?.planSlug).toBe('PRO');
  });

  it('PAST_DUE keeps access within the grace window, then revokes', () => {
    // Period ended in the past; grace 3 days from period end.
    const graceOk = decideEntitlement({ ...base, status: 'PAST_DUE', currentPeriodEnd: new Date('2026-06-14T00:00:00Z') }, now, 3);
    expect(graceOk).not.toBeNull(); // 1 day past end, within 3-day grace
    const graceGone = decideEntitlement({ ...base, status: 'PAST_DUE', currentPeriodEnd: new Date('2026-06-01T00:00:00Z') }, now, 3);
    expect(graceGone).toBeNull(); // 14 days past end, beyond grace
  });

  it('CANCELED keeps access only while still paid through the period', () => {
    expect(decideEntitlement({ ...base, status: 'CANCELED', currentPeriodEnd: future }, now)).not.toBeNull();
    expect(decideEntitlement({ ...base, status: 'CANCELED', currentPeriodEnd: past }, now)).toBeNull();
  });

  it('UNPAID / PAUSED / INCOMPLETE confer no entitlement', () => {
    for (const status of ['UNPAID', 'PAUSED', 'INCOMPLETE'] as const) {
      expect(decideEntitlement({ ...base, status, currentPeriodEnd: future }, now)).toBeNull();
    }
  });

  it('an organization subscription is sourced ORGANIZATION', () => {
    const d = decideEntitlement({ ...base, status: 'ACTIVE', currentPeriodEnd: future, organizationId: 'org1' }, now);
    expect(d?.source).toBe('ORGANIZATION');
  });
});

describe('MRR monthly normalization', () => {
  it('monthly price is itself; annual is /12; multi-month divides by count', () => {
    expect(monthlyAmount(4900, 'month', 1)).toBe(4900);
    expect(monthlyAmount(49000, 'year', 1)).toBeCloseTo(49000 / 12, 5);
    expect(monthlyAmount(9800, 'month', 2)).toBe(4900);
  });
});
