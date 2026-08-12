import { requireAdmin } from '@/server/auth/guards';
import { handleError, ok } from '@/lib/api';
import { memoryHealth } from '@/server/memory/admin';

/** GET /api/admin/memory — memory operational health (NO private content). */
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET() {
  const auth = await requireAdmin();
  if ('response' in auth) return auth.response;
  try {
    return ok(await memoryHealth());
  } catch (err) {
    return handleError(err, 'admin.memory.health');
  }
}
