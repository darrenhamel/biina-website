import type { PaymentProvider } from './provider';
import { StripeProvider } from './stripe/adapter';
import { billingProviderName } from './config';

/**
 * Payment-provider factory. The rest of BIINA never imports a vendor SDK — it
 * calls BillingService, which resolves the provider here. Tests inject a mock.
 */
let override: PaymentProvider | null = null;
let cached: PaymentProvider | null = null;

export function getPaymentProvider(): PaymentProvider {
  if (override) return override;
  if (cached) return cached;
  switch (billingProviderName()) {
    case 'stripe':
    default:
      cached = new StripeProvider();
  }
  return cached;
}

/** Test hook — inject a fake provider. Pass null to reset. */
export function setPaymentProvider(p: PaymentProvider | null): void {
  override = p;
  cached = null;
}

export * from './provider';
