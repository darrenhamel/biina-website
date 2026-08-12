import { requireAdmin } from '@/server/auth/guards';
import { handleError, ok } from '@/lib/api';
import { multimodalOverview } from '@/server/media/admin';

/** GET /api/admin/multimodal — provider selection, health, and usage (no content). */
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET() {
  const auth = await requireAdmin();
  if ('response' in auth) return auth.response;
  try {
    return ok(await multimodalOverview());
  } catch (err) {
    return handleError(err, 'admin.multimodal');
  }
}
