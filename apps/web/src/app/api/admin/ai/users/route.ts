import { NextResponse } from 'next/server';
import { requireAdmin } from '@/server/auth/guards';
import { listUsers } from '@/server/ai/admin';
import { handleError } from '@/lib/api';

/** GET /api/admin/ai/users — users + their plans (ADMIN only). No content/secrets. */
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET() {
  const auth = await requireAdmin();
  if ('response' in auth) return auth.response;
  try {
    return NextResponse.json({ users: await listUsers() });
  } catch (err) {
    return handleError(err, 'admin.ai.users');
  }
}
