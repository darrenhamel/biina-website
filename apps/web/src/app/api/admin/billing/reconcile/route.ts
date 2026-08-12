import { NextResponse } from 'next/server';
import { requireAdmin } from '@/server/auth/guards';
import { reconcileSubscriptions } from '@/server/billing/analytics';
import { billingEnabled } from '@/server/billing/config';
import { handleError } from '@/lib/api';

/**
 * POST /api/admin/billing/reconcile — compare local subscriptions to provider
 * state and heal drift (ADMIN). Manual now; a scheduled job can call the same
 * function later. No-op when billing is disabled.
 */
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST() {
  const auth = await requireAdmin();
  if ('response' in auth) return auth.response;
  try {
    if (!billingEnabled()) return NextResponse.json({ ok: true, skipped: 'billing_disabled', checked: 0, drift: [] });
    return NextResponse.json({ ok: true, ...(await reconcileSubscriptions()) });
  } catch (err) {
    return handleError(err, 'admin.billing.reconcile');
  }
}
