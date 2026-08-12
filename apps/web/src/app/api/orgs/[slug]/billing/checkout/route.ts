import { NextRequest, NextResponse } from 'next/server';
import { requireOrgOwner } from '@/server/org/guard';
import { startCheckout } from '@/server/billing/service';
import { checkoutSchema } from '@/lib/validation';
import { handleError } from '@/lib/api';

/**
 * POST /api/orgs/[slug]/billing/checkout — organization checkout (OWNER only).
 * Organization billing is controlled beta: the subscription is attached to the
 * ORGANIZATION, never the owner's personal account.
 */
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(req: NextRequest, { params }: { params: { slug: string } }) {
  const g = await requireOrgOwner(params.slug);
  if ('response' in g) return g.response;
  try {
    const { commercialPriceId } = checkoutSchema.parse(await req.json());
    const { url } = await startCheckout({
      scope: { organizationId: g.ctx.org.id },
      commercialPriceId,
      email: g.user.email,
      name: g.ctx.org.displayName,
      actorUserId: g.user.id,
    });
    return NextResponse.json({ url });
  } catch (err) {
    return handleError(err, 'orgs.billing.checkout');
  }
}
