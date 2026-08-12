import { NextResponse } from 'next/server';
import { listPublicPrices } from '@/server/billing/catalog';
import { loadBillingConfig, billingEnabled } from '@/server/billing/config';
import { handleError } from '@/lib/api';

/** GET /api/billing/prices — publicly listable commercial prices (pricing page). */
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET() {
  try {
    const [prices, config] = await Promise.all([listPublicPrices(), loadBillingConfig()]);
    // Never expose secrets — provider price ids are non-secret but unnecessary here.
    return NextResponse.json({
      billingEnabled: billingEnabled(),
      defaultCurrency: config.defaultCurrency,
      prices: prices.map((p) => ({
        id: p.id,
        planSlug: p.planSlug,
        displayName: p.displayName,
        currency: p.currency,
        amount: p.amount,
        billingInterval: p.billingInterval,
        billingIntervalCount: p.billingIntervalCount,
        trialDays: p.trialDays,
        isTest: p.isTest,
      })),
    });
  } catch (err) {
    return handleError(err, 'billing.prices');
  }
}
