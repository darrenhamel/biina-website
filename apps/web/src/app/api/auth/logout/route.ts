import { NextRequest } from 'next/server';
import { destroyCurrentSession, getCurrentUser, requestMeta } from '@/server/auth/session';
import { logSecurityEvent } from '@/server/auth/events';
import { ok, handleError } from '@/lib/api';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  try {
    const user = await getCurrentUser();
    await destroyCurrentSession();
    if (user) {
      const meta = requestMeta(req.headers);
      await logSecurityEvent({ event: 'logout', userId: user.id, actorUserId: user.id, ip: meta.ip, userAgent: meta.userAgent });
    }
    return ok({ ok: true });
  } catch (err) {
    return handleError(err, 'auth.logout');
  }
}
