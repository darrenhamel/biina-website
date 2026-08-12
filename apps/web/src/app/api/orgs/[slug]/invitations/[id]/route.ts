import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireOrgManager } from '@/server/org/guard';
import { revokeInvitation } from '@/server/org/invitations';
import { handleError } from '@/lib/api';

/** DELETE /api/orgs/[slug]/invitations/[id] — revoke a pending invitation. */
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const idSchema = z.string().uuid();

export async function DELETE(_req: NextRequest, { params }: { params: { slug: string; id: string } }) {
  const g = await requireOrgManager(params.slug);
  if ('response' in g) return g.response;
  try {
    const id = idSchema.parse(params.id);
    return NextResponse.json(await revokeInvitation(g.ctx.org.id, id, g.user.id));
  } catch (err) {
    return handleError(err, 'orgs.invitations.revoke');
  }
}
