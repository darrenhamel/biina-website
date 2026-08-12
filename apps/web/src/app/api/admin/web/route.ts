import { NextResponse } from 'next/server';
import { requireAdmin } from '@/server/auth/guards';
import { webSearchOverview } from '@/server/web/admin';
import { handleError } from '@/lib/api';

/** GET /api/admin/web — web-search operational overview (ADMIN). Never API keys. */
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET() {
  const auth = await requireAdmin();
  if ('response' in auth) return auth.response;
  try {
    return NextResponse.json(await webSearchOverview());
  } catch (err) {
    return handleError(err, 'admin.web.overview');
  }
}
