import { requireAdmin } from '@/server/auth/guards';
import { handleError, ok } from '@/lib/api';
import { automationsOverview } from '@/server/workflows/admin';

/** GET /api/admin/automations — platform automation health + metadata (no content). */
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET() {
  const auth = await requireAdmin();
  if ('response' in auth) return auth.response;
  try {
    return ok(await automationsOverview());
  } catch (err) {
    return handleError(err, 'admin.automations');
  }
}
