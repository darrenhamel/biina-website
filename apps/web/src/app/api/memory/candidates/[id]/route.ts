import { NextRequest } from 'next/server';
import { eq, and } from 'drizzle-orm';
import { getDb } from '@/server/db';
import { memoryCandidates } from '@/server/db/schema';
import { requireUser } from '@/server/auth/guards';
import { getPlan } from '@/server/ai/plans';
import { candidateDecisionSchema } from '@/lib/validation';
import { handleError, ok, notFound } from '@/lib/api';
import { acceptCandidate, rejectCandidate } from '@/server/memory/extraction';

/** POST /api/memory/candidates/[id] — accept (→ save memory) or reject a suggestion. */
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireUser();
  if ('response' in auth) return auth.response;
  try {
    const { decision, confirmSensitive } = candidateDecisionSchema.parse(await req.json());
    const [candidate] = await getDb().select().from(memoryCandidates).where(and(eq(memoryCandidates.id, params.id), eq(memoryCandidates.ownerUserId, auth.user.id), eq(memoryCandidates.status, 'PENDING'))).limit(1);
    if (!candidate) return notFound('Suggestion not found');

    if (decision === 'REJECTED') {
      await rejectCandidate(candidate.id, auth.user.id);
      return ok({ ok: true, status: 'REJECTED' });
    }
    const plan = await getPlan(auth.user.plan);
    const mem = await acceptCandidate(candidate, auth.user.id, plan, Boolean(confirmSensitive));
    return ok({ ok: true, status: 'ACCEPTED', memoryId: mem.id });
  } catch (err) {
    return handleError(err, 'memory.candidates.decide');
  }
}
