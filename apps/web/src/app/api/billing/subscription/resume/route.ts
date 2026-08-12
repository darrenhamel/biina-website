import { NextRequest, NextResponse } from 'next/server';
import { requireUser } from '@/server/auth/guards';
import { resumeSubscription } from '@/server/billing/service';
import { resumeSubSchema } from '@/lib/validation';
import { handleError } from '@/lib/api';

/** POST /api/billing/subscription/resume — undo a pending cancellation. */
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  const auth = await requireUser();
  if ('response' in auth) return auth.response;
  try {
    const { subscriptionId } = resumeSubSchema.parse(await req.json());
    const sub = await resumeSubscription({ userId: auth.user.id }, subscriptionId, auth.user.id);
    return NextResponse.json({ ok: true, status: sub.status, cancelAtPeriodEnd: sub.cancelAtPeriodEnd });
  } catch (err) {
    return handleError(err, 'billing.subscription.resume');
  }
}
