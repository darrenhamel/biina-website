import { NextResponse } from 'next/server';
import { requireOrgOwner } from '@/server/org/guard';
import { getBillingSummary } from '@/server/billing/service';
import { billingEnabled } from '@/server/billing/config';
import { handleError } from '@/lib/api';

/** GET /api/orgs/[slug]/billing — org billing summary (OWNER only). */
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(_req: Request, { params }: { params: { slug: string } }) {
  const g = await requireOrgOwner(params.slug);
  if ('response' in g) return g.response;
  try {
    const summary = await getBillingSummary({ organizationId: g.ctx.org.id });
    return NextResponse.json({ ...summary, plan: g.ctx.org.planSlug ?? 'FREE', billingEnabled: billingEnabled() });
  } catch (err) {
    return handleError(err, 'orgs.billing.summary');
  }
}
