import { NextResponse } from 'next/server';
import { requireAdmin } from '@/server/auth/guards';
import { getAdminCatalog, refreshProviderHealth } from '@/server/ai/admin';
import { handleError } from '@/lib/api';

/** GET /api/admin/ai/config — full control-plane view (ADMIN only, secrets redacted). */
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET() {
  const auth = await requireAdmin();
  if ('response' in auth) return auth.response;
  try {
    // Live-probe provider health so the admin sees current state.
    await refreshProviderHealth().catch(() => {});
    return NextResponse.json(await getAdminCatalog());
  } catch (err) {
    return handleError(err, 'admin.ai.config');
  }
}
