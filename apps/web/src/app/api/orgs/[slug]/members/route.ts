import { NextResponse } from 'next/server';
import { requireOrgMember } from '@/server/org/guard';
import { listMembers } from '@/server/org/members';
import { handleError } from '@/lib/api';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(_req: Request, { params }: { params: { slug: string } }) {
  const g = await requireOrgMember(params.slug);
  if ('response' in g) return g.response;
  try {
    return NextResponse.json({ members: await listMembers(g.ctx.org.id), myRole: g.ctx.role });
  } catch (err) {
    return handleError(err, 'orgs.members.list');
  }
}
