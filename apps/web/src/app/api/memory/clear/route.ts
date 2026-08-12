import { requireUser } from '@/server/auth/guards';
import { handleError, ok } from '@/lib/api';
import { clearPersonalMemory } from '@/server/memory/store';

/**
 * POST /api/memory/clear — delete ALL of the caller's personal memory. Does NOT
 * touch account, conversations, files, or knowledge bases (distinct data category).
 */
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST() {
  const auth = await requireUser();
  if ('response' in auth) return auth.response;
  try {
    const count = await clearPersonalMemory(auth.user.id);
    return ok({ ok: true, cleared: count });
  } catch (err) {
    return handleError(err, 'memory.clear');
  }
}
