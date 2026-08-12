import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireOrgManager, requireOrgOwner } from '@/server/org/guard';
import { removeMember, changeMemberRole } from '@/server/org/members';
import { memberRoleSchema } from '@/lib/validation';
import { handleError } from '@/lib/api';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const idSchema = z.string().uuid();

/** Remove a member (OWNER any; ADMIN members-only; owner-count protected). */
export async function DELETE(_req: NextRequest, { params }: { params: { slug: string; userId: string } }) {
  const g = await requireOrgManager(params.slug);
  if ('response' in g) return g.response;
  try {
    const userId = idSchema.parse(params.userId);
    return NextResponse.json(await removeMember(g.ctx.org.id, { id: g.user.id, role: g.ctx.role }, userId));
  } catch (err) {
    return handleError(err, 'orgs.members.remove');
  }
}

/** Change a member's role (OWNER only). */
export async function PATCH(req: NextRequest, { params }: { params: { slug: string; userId: string } }) {
  const g = await requireOrgOwner(params.slug);
  if ('response' in g) return g.response;
  try {
    const userId = idSchema.parse(params.userId);
    const { role } = memberRoleSchema.parse(await req.json());
    return NextResponse.json(await changeMemberRole(g.ctx.org.id, { id: g.user.id, role: g.ctx.role }, userId, role));
  } catch (err) {
    return handleError(err, 'orgs.members.role');
  }
}
