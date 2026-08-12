import { NextRequest, NextResponse } from 'next/server';
import { requireOrgMember, requireOrgManager } from '@/server/org/guard';
import { updateOrgSettings } from '@/server/org/organizations';
import { updateOrgSchema } from '@/lib/validation';
import { handleError } from '@/lib/api';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(_req: NextRequest, { params }: { params: { slug: string } }) {
  const g = await requireOrgMember(params.slug);
  if ('response' in g) return g.response;
  const { org, role } = g.ctx;
  return NextResponse.json({
    organization: { slug: org.slug, displayName: org.displayName, status: org.status },
    role,
  });
}

export async function PATCH(req: NextRequest, { params }: { params: { slug: string } }) {
  const g = await requireOrgManager(params.slug);
  if ('response' in g) return g.response;
  try {
    const patch = updateOrgSchema.parse(await req.json());
    return NextResponse.json(await updateOrgSettings(g.ctx.org.id, patch, g.user.id));
  } catch (err) {
    return handleError(err, 'orgs.update');
  }
}
