import { NextRequest, NextResponse } from 'next/server';
import { requireUser } from '@/server/auth/guards';
import { changeSubscription } from '@/server/billing/service';
import { changeSubSchema } from '@/lib/validation';
import { handleError } from '@/lib/api';

/** POST /api/billing/subscription/change — upgrade/downgrade to another price. */
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  const auth = await requireUser();
  if ('response' in auth) return auth.response;
  try {
    const { subscriptionId, commercialPriceId } = changeSubSchema.parse(await req.json());
    const sub = await changeSubscription({ userId: auth.user.id }, subscriptionId, commercialPriceId, auth.user.id);
    return NextResponse.json({ ok: true, status: sub.status, planSlug: sub.planSlug });
  } catch (err) {
    return handleError(err, 'billing.subscription.change');
  }
}
