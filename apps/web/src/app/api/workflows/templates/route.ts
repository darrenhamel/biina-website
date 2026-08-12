import { requireUser } from '@/server/auth/guards';
import { handleError, ok } from '@/lib/api';
import { WORKFLOW_TEMPLATES } from '@/server/workflows/templates';

/** GET /api/workflows/templates — built-in workflow templates (structure only). */
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET() {
  const auth = await requireUser();
  if ('response' in auth) return auth.response;
  try {
    return ok({ templates: WORKFLOW_TEMPLATES });
  } catch (err) {
    return handleError(err, 'workflows.templates');
  }
}
