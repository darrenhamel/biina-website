import { describe, it, expect } from 'vitest';
import { createHmac } from 'node:crypto';
import { verifyStripeSignature, encodeForm, normalizeSubscription } from '@/server/billing/stripe/adapter';

/** Webhook signature verification is the ONLY thing that authenticates a webhook. */
const SECRET = 'whsec_test_secret';

function sign(payload: string, ts: number, secret = SECRET): string {
  const sig = createHmac('sha256', secret).update(`${ts}.${payload}`).digest('hex');
  return `t=${ts},v1=${sig}`;
}

describe('verifyStripeSignature', () => {
  const now = 1_700_000_000;
  const payload = JSON.stringify({ id: 'evt_1', type: 'customer.subscription.updated' });

  it('accepts a correctly-signed, in-tolerance payload', () => {
    expect(() => verifyStripeSignature(payload, sign(payload, now), SECRET, now)).not.toThrow();
  });

  it('rejects a missing or malformed signature', () => {
    expect(() => verifyStripeSignature(payload, null, SECRET, now)).toThrow();
    expect(() => verifyStripeSignature(payload, 't=123', SECRET, now)).toThrow();
  });

  it('rejects a tampered payload (signature no longer matches)', () => {
    const header = sign(payload, now);
    expect(() => verifyStripeSignature(payload + 'x', header, SECRET, now)).toThrow();
  });

  it('rejects a wrong secret', () => {
    expect(() => verifyStripeSignature(payload, sign(payload, now, 'whsec_other'), SECRET, now)).toThrow();
  });

  it('rejects a stale timestamp (replay outside tolerance)', () => {
    const old = now - 10 * 60; // 10 minutes old > 5 min tolerance
    expect(() => verifyStripeSignature(payload, sign(payload, old), SECRET, now)).toThrow();
  });
});

describe('encodeForm', () => {
  it('encodes nested objects and arrays in Stripe bracket form', () => {
    const out = encodeForm({ mode: 'subscription', line_items: [{ price: 'price_1', quantity: 1 }], metadata: { userId: 'u1' } });
    expect(out).toContain('mode=subscription');
    expect(out).toContain(encodeURIComponent('line_items[0][price]') + '=price_1');
    expect(out).toContain(encodeURIComponent('metadata[userId]') + '=u1');
  });

  it('skips null/undefined', () => {
    expect(encodeForm({ a: null, b: undefined, c: 'x' })).toBe('c=x');
  });
});

describe('normalizeSubscription (status mapping)', () => {
  it('maps vendor statuses into our normalized set', () => {
    const s = normalizeSubscription({
      id: 'sub_1',
      customer: 'cus_1',
      status: 'trialing',
      current_period_end: 1_700_000_000,
      items: { data: [{ price: { id: 'price_1' } }] },
      metadata: { userId: 'u1' },
    } as never);
    expect(s.status).toBe('TRIALING');
    expect(s.providerPriceId).toBe('price_1');
    expect(s.providerCustomerId).toBe('cus_1');
    expect(s.currentPeriodEnd?.getTime()).toBe(1_700_000_000 * 1000);
  });

  it('maps incomplete_expired to CANCELED and unknown to INCOMPLETE', () => {
    expect(normalizeSubscription({ id: 's', customer: null, status: 'incomplete_expired' } as never).status).toBe('CANCELED');
    expect(normalizeSubscription({ id: 's', customer: null, status: 'weird' } as never).status).toBe('INCOMPLETE');
  });
});
