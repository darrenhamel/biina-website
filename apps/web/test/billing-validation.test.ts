import { describe, it, expect, afterEach } from 'vitest';
import {
  checkoutSchema,
  cancelSubSchema,
  changeSubSchema,
  upsertCommercialPriceSchema,
  billingConfigSchema,
} from '@/lib/validation';
import { billingEnabled, billingLiveMode } from '@/server/billing/config';
import { BillingError } from '@/server/billing/provider';

describe('billing validation', () => {
  it('checkout requires a uuid commercial price id (no arbitrary provider id)', () => {
    expect(() => checkoutSchema.parse({ commercialPriceId: 'price_123' })).toThrow(); // Stripe id rejected
    expect(checkoutSchema.parse({ commercialPriceId: '11111111-1111-1111-1111-111111111111' }).commercialPriceId).toBeTruthy();
  });

  it('cancel defaults to at-period-end (customer-friendly)', () => {
    expect(cancelSubSchema.parse({ subscriptionId: '11111111-1111-1111-1111-111111111111' }).atPeriodEnd).toBe(true);
  });

  it('change requires both uuids', () => {
    expect(() => changeSubSchema.parse({ subscriptionId: 'x', commercialPriceId: 'y' })).toThrow();
  });

  it('commercial price enforces plan enum, currency length, integer minor amount', () => {
    const ok = upsertCommercialPriceSchema.parse({
      planSlug: 'PRO',
      displayName: 'Pro Monthly',
      providerPriceId: 'price_x',
      currency: 'aed',
      amount: 4900,
    });
    expect(ok.currency).toBe('AED'); // uppercased
    expect(ok.billingInterval).toBe('month');
    expect(() => upsertCommercialPriceSchema.parse({ planSlug: 'GOLD', displayName: 'x', providerPriceId: 'p', currency: 'AED', amount: 1 })).toThrow();
    expect(() => upsertCommercialPriceSchema.parse({ planSlug: 'PRO', displayName: 'x', providerPriceId: 'p', currency: 'AED', amount: 4.9 })).toThrow();
  });

  it('billing config only accepts known tax modes', () => {
    expect(billingConfigSchema.parse({ taxMode: 'exclusive' }).taxMode).toBe('exclusive');
    expect(() => billingConfigSchema.parse({ taxMode: 'vat-ish' })).toThrow();
  });
});

describe('billing safety flags', () => {
  const orig = { ...process.env };
  afterEach(() => {
    process.env = { ...orig };
  });

  it('billing is disabled by default and live mode is never inferred', () => {
    delete process.env.BILLING_ENABLED;
    delete process.env.BILLING_LIVE_MODE;
    process.env.STRIPE_SECRET_KEY = 'sk_live_something';
    expect(billingEnabled()).toBe(false);
    // Even with a live key present, live mode requires the explicit flag.
    expect(billingLiveMode()).toBe(false);
    process.env.BILLING_LIVE_MODE = 'true';
    expect(billingLiveMode()).toBe(true); // flag + sk_live_ key
    process.env.STRIPE_SECRET_KEY = 'sk_test_x';
    expect(billingLiveMode()).toBe(false); // test key → never live
  });
});

describe('BillingError', () => {
  it('carries a safe status + code', () => {
    const e = new BillingError(400, 'invalid_price', 'Unknown price');
    expect(e.status).toBe(400);
    expect(e.code).toBe('invalid_price');
    expect(e.name).toBe('BillingError');
  });
});
