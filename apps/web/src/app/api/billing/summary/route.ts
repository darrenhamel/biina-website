import { NextResponse } from 'next/server';
import { requireUser } from '@/server/auth/guards';
import { getBillingSummary } from '@/server/billing/service';
import { billingEnabled } from '@/server/billing/config';
import { handleError } from '@/lib/api';

/** GET /api/billing/summary — the user's current plan/subscription/invoices. */
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET() {
  const auth = await requireUser();
  if ('response' in auth) return auth.response;
  try {
    const summary = await getBillingSummary({ userId: auth.user.id });
    return NextResponse.json({ ...summary, plan: auth.user.plan, billingEnabled: billingEnabled() });
  } catch (err) {
    return handleError(err, 'billing.summary');
  }
}
