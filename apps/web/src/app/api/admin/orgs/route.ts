import { NextResponse } from 'next/server';
import { requireAdmin } from '@/server/auth/guards';
import { listAllOrgs } from '@/server/org/organizations';
import { handleError } from '@/lib/api';

/** GET /api/admin/orgs — all organizations with member counts (ADMIN only). */
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET() {
  const auth = await requireAdmin();
  if ('response' in auth) return auth.response;
  try {
    return NextResponse.json({ organizations: await listAllOrgs() });
  } catch (err) {
    return handleError(err, 'admin.orgs.list');
  }
}
