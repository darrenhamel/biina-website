import { requireAdmin } from '@/server/auth/guards';
import { handleError, ok } from '@/lib/api';
import { researchOverview } from '@/server/research/admin';

/** GET /api/admin/research — research operational metadata (no private content). */
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET() {
  const auth = await requireAdmin();
  if ('response' in auth) return auth.response;
  try {
    return ok(await researchOverview());
  } catch (err) {
    return handleError(err, 'admin.research');
  }
}
