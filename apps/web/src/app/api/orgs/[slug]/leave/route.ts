import { NextResponse } from 'next/server';
import { requireOrgMember } from '@/server/org/guard';
import { leaveOrganization } from '@/server/org/members';
import { handleError } from '@/lib/api';

/** POST /api/orgs/[slug]/leave — leave (blocked if you are the only owner). */
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(_req: Request, { params }: { params: { slug: string } }) {
  const g = await requireOrgMember(params.slug);
  if ('response' in g) return g.response;
  try {
    return NextResponse.json(await leaveOrganization(g.ctx.org.id, { id: g.user.id, role: g.ctx.role }));
  } catch (err) {
    return handleError(err, 'orgs.leave');
  }
}
