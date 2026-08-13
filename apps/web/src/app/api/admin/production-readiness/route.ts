import { requireAdmin } from '@/server/auth/guards';
import { handleError, ok } from '@/lib/api';
import { validateProductionConfig } from '@/server/config/production';

/**
 * GET /api/admin/production-readiness — admin-only configuration readiness check.
 * Reports missing/weak production configuration by variable NAME + severity only;
 * never returns secret values. Used by the launch checklist + ops dashboard.
 */
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET() {
  const auth = await requireAdmin();
  if ('response' in auth) return auth.response;
  try {
    const result = validateProductionConfig();
    const bySeverity = { CRITICAL: 0, HIGH: 0, MEDIUM: 0, INFO: 0 } as Record<string, number>;
    for (const f of result.findings) bySeverity[f.severity]++;
    return ok({ production: result.production, ok: result.ok, summary: bySeverity, findings: result.findings });
  } catch (err) {
    return handleError(err, 'admin.production_readiness');
  }
}
