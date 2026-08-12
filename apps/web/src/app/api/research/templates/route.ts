import { requireUser } from '@/server/auth/guards';
import { handleError, ok } from '@/lib/api';
import { RESEARCH_TEMPLATES } from '@/server/research/admin';

/** GET /api/research/templates — built-in research plan templates (structure only). */
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET() {
  const auth = await requireUser();
  if ('response' in auth) return auth.response;
  try {
    return ok({ templates: RESEARCH_TEMPLATES });
  } catch (err) {
    return handleError(err, 'research.templates');
  }
}
