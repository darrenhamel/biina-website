import { NextResponse } from 'next/server';
import { requireUser } from '@/server/auth/guards';
import { openBillingPortal } from '@/server/billing/service';
import { handleError } from '@/lib/api';

/** POST /api/billing/portal — open the provider billing portal (auth required). */
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST() {
  const auth = await requireUser();
  if ('response' in auth) return auth.response;
  try {
    const { url } = await openBillingPortal({ userId: auth.user.id });
    return NextResponse.json({ url });
  } catch (err) {
    return handleError(err, 'billing.portal');
  }
}
