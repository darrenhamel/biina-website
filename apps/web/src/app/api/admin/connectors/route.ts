import { NextResponse } from 'next/server';
import { requireAdmin } from '@/server/auth/guards';
import { connectorAdminOverview } from '@/server/connectors/admin';
import { handleError } from '@/lib/api';

/** GET /api/admin/connectors — connector overview (ADMIN). Never tokens/content. */
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET() {
  const auth = await requireAdmin();
  if ('response' in auth) return auth.response;
  try {
    return NextResponse.json(await connectorAdminOverview());
  } catch (err) {
    return handleError(err, 'admin.connectors.overview');
  }
}
