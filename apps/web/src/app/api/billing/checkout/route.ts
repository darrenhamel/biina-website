import { NextRequest, NextResponse } from 'next/server';
import { requireUser } from '@/server/auth/guards';
import { startCheckout } from '@/server/billing/service';
import { checkoutSchema } from '@/lib/validation';
import { handleError } from '@/lib/api';

/** POST /api/billing/checkout — start a personal-plan checkout (auth required). */
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  const auth = await requireUser();
  if ('response' in auth) return auth.response;
  try {
    const { commercialPriceId } = checkoutSchema.parse(await req.json());
    const { url } = await startCheckout({
      scope: { userId: auth.user.id },
      commercialPriceId,
      email: auth.user.email,
      name: auth.user.displayName,
      actorUserId: auth.user.id,
    });
    return NextResponse.json({ url });
  } catch (err) {
    return handleError(err, 'billing.checkout');
  }
}
