import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAdmin } from '@/server/auth/guards';
import { setUserStatus } from '@/server/ai/admin';
import { setUserStatusSchema } from '@/lib/validation';
import { handleError } from '@/lib/api';

/** PUT /api/admin/users/[id]/status — suspend / reactivate / disable (ADMIN). */
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const idSchema = z.string().uuid();

export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireAdmin();
  if ('response' in auth) return auth.response;
  try {
    const id = idSchema.parse(params.id);
    const { status, reason } = setUserStatusSchema.parse(await req.json());
    return NextResponse.json(await setUserStatus(id, status, auth.user.id, reason));
  } catch (err) {
    return handleError(err, 'admin.users.status');
  }
}
