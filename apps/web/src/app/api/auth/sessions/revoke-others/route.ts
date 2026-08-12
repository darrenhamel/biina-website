import { NextRequest } from 'next/server';
import { requireUser } from '@/server/auth/guards';
import { revokeOtherSessions, requestMeta } from '@/server/auth/session';
import { logSecurityEvent } from '@/server/auth/events';
import { ok, handleError } from '@/lib/api';

/** POST /api/auth/sessions/revoke-others — sign out all other devices. */
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  const auth = await requireUser();
  if ('response' in auth) return auth.response;
  try {
    await revokeOtherSessions(auth.user.id);
    const meta = requestMeta(req.headers);
    await logSecurityEvent({ event: 'sessions.revoked_others', userId: auth.user.id, actorUserId: auth.user.id, ip: meta.ip, userAgent: meta.userAgent });
    return ok({ ok: true });
  } catch (err) {
    return handleError(err, 'auth.sessions.revoke_others');
  }
}
