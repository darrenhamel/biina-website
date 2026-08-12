import { NextRequest } from 'next/server';
import { requireUser } from '@/server/auth/guards';
import { revokeSession, requestMeta } from '@/server/auth/session';
import { logSecurityEvent } from '@/server/auth/events';
import { ok, notFound, handleError } from '@/lib/api';

/** DELETE /api/auth/sessions/[id] — revoke one of the user's own sessions. */
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireUser();
  if ('response' in auth) return auth.response;
  try {
    const removed = await revokeSession(params.id, auth.user.id);
    if (!removed) return notFound('Session not found');
    const meta = requestMeta(req.headers);
    await logSecurityEvent({ event: 'session.revoked', userId: auth.user.id, actorUserId: auth.user.id, ip: meta.ip, userAgent: meta.userAgent });
    return ok({ ok: true });
  } catch (err) {
    return handleError(err, 'auth.sessions.revoke');
  }
}
