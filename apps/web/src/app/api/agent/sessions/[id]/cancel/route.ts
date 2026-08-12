import { NextRequest } from 'next/server';
import { requireUser } from '@/server/auth/guards';
import { activeWorkspace } from '@/server/org/workspace';
import { handleError, ok, notFound, forbidden } from '@/lib/api';
import { resolveSessionAccess } from '@/server/agent/sessions';
import { cancelAgentSession } from '@/server/agent/orchestrator';

/**
 * POST /api/agent/sessions/[id]/cancel — user cancellation. Stops future steps and
 * pending (not-yet-started) actions. An already-executed external write cannot be
 * un-sent; its recorded outcome stands.
 */
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireUser();
  if ('response' in auth) return auth.response;
  try {
    const ws = await activeWorkspace(req, auth.user.id);
    const access = await resolveSessionAccess(auth.user.id, params.id, ws.organizationId);
    if (!access) return notFound('Session not found');
    if (!access.canManage) return forbidden('You cannot cancel this run.');
    await cancelAgentSession(params.id);
    return ok({ ok: true, status: 'CANCELED' });
  } catch (err) {
    return handleError(err, 'agent.session.cancel');
  }
}
