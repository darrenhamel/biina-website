import { NextResponse } from 'next/server';
import { requireOrgOwner } from '@/server/org/guard';
import { openBillingPortal } from '@/server/billing/service';
import { handleError } from '@/lib/api';

/** POST /api/orgs/[slug]/billing/portal — org billing portal (OWNER only). */
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(_req: Request, { params }: { params: { slug: string } }) {
  const g = await requireOrgOwner(params.slug);
  if ('response' in g) return g.response;
  try {
    const { url } = await openBillingPortal({ organizationId: g.ctx.org.id });
    return NextResponse.json({ url });
  } catch (err) {
    return handleError(err, 'orgs.billing.portal');
  }
}
