import { NextResponse } from 'next/server';
import { requireAdmin } from '@/server/auth/guards';
import {
  subscriptionCounts,
  mrrByCurrency,
  recentBillingChanges,
  planUnitEconomics,
  freeUserAiCost,
} from '@/server/billing/analytics';
import { billingEnabled, billingLiveMode } from '@/server/billing/config';
import { handleError } from '@/lib/api';

/** GET /api/admin/billing — operational billing overview (ADMIN). All estimates. */
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET() {
  const auth = await requireAdmin();
  if ('response' in auth) return auth.response;
  try {
    const now = new Date();
    const [counts, mrr, changes, unitEconomics, freeCost] = await Promise.all([
      subscriptionCounts(),
      mrrByCurrency(),
      recentBillingChanges(now),
      planUnitEconomics(now),
      freeUserAiCost(now),
    ]);
    return NextResponse.json({
      billingEnabled: billingEnabled(),
      liveMode: billingLiveMode(),
      counts,
      mrr,
      changes,
      unitEconomics,
      freeCost,
    });
  } catch (err) {
    return handleError(err, 'admin.billing.overview');
  }
}
