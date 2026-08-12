import { NextRequest } from 'next/server';
import { requireUser } from '@/server/auth/guards';
import { activeWorkspace } from '@/server/org/workspace';
import { getPlan } from '@/server/ai/plans';
import { handleError, ok, notFound, forbidden } from '@/lib/api';
import { resolveResearchAccess } from '@/server/research/sessions';
import { runResearch } from '@/server/research/orchestrator';

/** POST /api/research/[id]/run — execute a planned (e.g. reviewed DEEP) research run. */
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireUser();
  if ('response' in auth) return auth.response;
  try {
    const ws = await activeWorkspace(req, auth.user.id);
    const access = await resolveResearchAccess(auth.user.id, params.id, ws.organizationId);
    if (!access) return notFound('Research not found');
    if (!access.canManage) return forbidden('You cannot run this research.');
    if (access.session.status !== 'PLANNING') return ok({ ok: false, error: 'Already started' }, { status: 400 });
    const plan = await getPlan(auth.user.plan); // LIVE entitlement re-check
    const status = await runResearch(access.session, { plan, signal: req.signal });
    return ok({ ok: true, status });
  } catch (err) {
    return handleError(err, 'research.run');
  }
}
