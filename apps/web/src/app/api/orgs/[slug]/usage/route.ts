import { NextResponse } from 'next/server';
import { requireOrgManager } from '@/server/org/guard';
import { orgUsageSummary } from '@/server/ai/ledger';
import { handleError } from '@/lib/api';

/** GET /api/orgs/[slug]/usage — aggregate org usage (managers only). */
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(_req: Request, { params }: { params: { slug: string } }) {
  const g = await requireOrgManager(params.slug);
  if ('response' in g) return g.response;
  try {
    return NextResponse.json({ usage: await orgUsageSummary(g.ctx.org.id, new Date()) });
  } catch (err) {
    return handleError(err, 'orgs.usage');
  }
}
