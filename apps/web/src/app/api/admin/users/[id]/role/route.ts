import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireSuperAdmin } from '@/server/auth/guards';
import { setUserRole } from '@/server/ai/admin';
import { setUserRoleSchema } from '@/lib/validation';
import { handleError } from '@/lib/api';

/** PUT /api/admin/users/[id]/role — change a platform role (SUPER_ADMIN only). */
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const idSchema = z.string().uuid();

export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireSuperAdmin();
  if ('response' in auth) return auth.response;
  try {
    const id = idSchema.parse(params.id);
    const { role } = setUserRoleSchema.parse(await req.json());
    return NextResponse.json(await setUserRole(id, role, auth.user.id));
  } catch (err) {
    return handleError(err, 'admin.users.role');
  }
}
