import { requireAdmin } from '@/server/auth/guards';
import { handleError, ok } from '@/lib/api';
import { libraryOverview } from '@/server/library/admin';

/** GET /api/admin/library — library operational metadata (no private item content). */
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET() {
  const auth = await requireAdmin();
  if ('response' in auth) return auth.response;
  try {
    return ok(await libraryOverview());
  } catch (err) {
    return handleError(err, 'admin.library');
  }
}
