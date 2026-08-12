import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAdmin } from '@/server/auth/guards';
import { setOrgStatus } from '@/server/org/organizations';
import { setOrgStatusSchema } from '@/lib/validation';
import { handleError } from '@/lib/api';

/** PUT /api/admin/orgs/[id]/status — suspend / reactivate an org (ADMIN). */
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const idSchema = z.string().uuid();

export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireAdmin();
  if ('response' in auth) return auth.response;
  try {
    const id = idSchema.parse(params.id);
    const { status, reason } = setOrgStatusSchema.parse(await req.json());
    return NextResponse.json(await setOrgStatus(id, status, auth.user.id, reason));
  } catch (err) {
    return handleError(err, 'admin.orgs.status');
  }
}
