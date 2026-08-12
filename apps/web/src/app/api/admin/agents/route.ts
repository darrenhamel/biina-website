import { requireAdmin } from '@/server/auth/guards';
import { handleError, ok } from '@/lib/api';
import { agentAdminOverview } from '@/server/agent/admin';

/** GET /api/admin/agents — platform-wide agent operational metadata (no content). */
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET() {
  const auth = await requireAdmin();
  if ('response' in auth) return auth.response;
  try {
    const overview = await agentAdminOverview();
    return ok(overview);
  } catch (err) {
    return handleError(err, 'admin.agents.overview');
  }
}
