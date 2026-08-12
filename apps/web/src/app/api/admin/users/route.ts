import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/server/auth/guards';
import { listUsers } from '@/server/ai/admin';
import { handleError } from '@/lib/api';

/** GET /api/admin/users?q= — platform users with status/role/plan (ADMIN only). */
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const auth = await requireAdmin();
  if ('response' in auth) return auth.response;
  try {
    const q = req.nextUrl.searchParams.get('q') ?? undefined;
    return NextResponse.json({ users: await listUsers(q) });
  } catch (err) {
    return handleError(err, 'admin.users.list');
  }
}
