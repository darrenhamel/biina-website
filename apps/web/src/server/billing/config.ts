import { eq } from 'drizzle-orm';
import { getDb } from '@/server/db';
import { billingConfig } from '@/server/db/schema';
import type { BillingConfig } from '@/server/db/schema';

/**
 * Billing configuration & safety flags.
 *
 * SAFETY: two independent env switches gate real charges. Both default OFF, and
 * live mode is NEVER inferred from the mere presence of keys.
 *   - BILLING_ENABLED   → checkout / portal / provider writes are allowed at all.
 *   - BILLING_LIVE_MODE → talk to the provider in LIVE mode (real money).
 * With BILLING_ENABLED=false the pricing page still renders, but checkout is
 * disabled. Secrets (provider keys) live ONLY in env, never in the DB.
 */

export function billingEnabled(): boolean {
  return process.env.BILLING_ENABLED === 'true';
}

/** Live mode requires the explicit flag AND a live-looking secret key. Never inferred. */
export function billingLiveMode(): boolean {
  if (process.env.BILLING_LIVE_MODE !== 'true') return false;
  const key = process.env.STRIPE_SECRET_KEY ?? '';
  return key.startsWith('sk_live_');
}

export function billingProviderName(): string {
  return process.env.BILLING_PROVIDER || 'stripe';
}

/** Absolute base URL for building checkout/portal return links. */
export function appBaseUrl(): string {
  return (process.env.APP_URL || process.env.APP_BASE_URL || 'http://localhost:3000').replace(/\/$/, '');
}

/** True when we appear configured enough to attempt provider calls (test or live). */
export function billingConfigured(): boolean {
  return billingEnabled() && Boolean(process.env.STRIPE_SECRET_KEY);
}

const SINGLETON = 'singleton';
const DEFAULTS = {
  id: SINGLETON,
  defaultCurrency: 'AED',
  taxEnabled: false,
  taxMode: 'none',
  taxInclusive: false,
  taxRegistrationNumber: null,
  taxRateReference: null,
  legalEntityName: null,
  billingCountry: 'AE',
  supportEmail: null,
  updatedAt: new Date(0),
} as BillingConfig;

/** Load the (non-secret) commercial/tax config, falling back to safe defaults. */
export async function loadBillingConfig(): Promise<BillingConfig> {
  const [row] = await getDb().select().from(billingConfig).where(eq(billingConfig.id, SINGLETON)).limit(1);
  return row ?? DEFAULTS;
}

export async function updateBillingConfig(patch: Partial<BillingConfig>, actorUserId: string) {
  const set: Record<string, unknown> = { updatedAt: new Date() };
  for (const key of [
    'defaultCurrency',
    'taxEnabled',
    'taxMode',
    'taxInclusive',
    'taxRegistrationNumber',
    'taxRateReference',
    'legalEntityName',
    'billingCountry',
    'supportEmail',
  ] as const) {
    if (patch[key] !== undefined) set[key] = patch[key];
  }
  const { writeAudit } = await import('@/server/ai/audit');
  await getDb()
    .insert(billingConfig)
    .values({ id: SINGLETON, ...set })
    .onConflictDoUpdate({ target: billingConfig.id, set });
  await writeAudit({ adminUserId: actorUserId, action: 'billing.config.update', targetType: 'billing_config', targetId: SINGLETON, newValue: set });
  return { ok: true };
}
