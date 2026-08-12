import { requireUser } from '@/server/auth/guards';
import { handleError, ok } from '@/lib/api';
import { listCandidates } from '@/server/memory/extraction';

/** GET /api/memory/candidates — pending inferred-memory suggestions (ASK mode). */
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET() {
  const auth = await requireUser();
  if ('response' in auth) return auth.response;
  try {
    const rows = await listCandidates(auth.user.id);
    return ok({ candidates: rows.map((c) => ({ id: c.id, content: c.candidateContent, type: c.memoryType, sensitivity: c.sensitivity, reason: c.reason, createdAt: c.createdAt })) });
  } catch (err) {
    return handleError(err, 'memory.candidates.list');
  }
}
