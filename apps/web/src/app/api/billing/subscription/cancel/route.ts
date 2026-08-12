import { NextRequest, NextResponse } from 'next/server';
import { requireUser } from '@/server/auth/guards';
import { cancelSubscription } from '@/server/billing/service';
import { cancelSubSchema } from '@/lib/validation';
import { handleError } from '@/lib/api';

/** POST /api/billing/subscription/cancel — cancel (default: at period end). */
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  const auth = await requireUser();
  if ('response' in auth) return auth.response;
  try {
    const { subscriptionId, atPeriodEnd } = cancelSubSchema.parse(await req.json());
    const sub = await cancelSubscription({ userId: auth.user.id }, subscriptionId, auth.user.id, atPeriodEnd);
    return NextResponse.json({ ok: true, status: sub.status, cancelAtPeriodEnd: sub.cancelAtPeriodEnd });
  } catch (err) {
    return handleError(err, 'billing.subscription.cancel');
  }
}
