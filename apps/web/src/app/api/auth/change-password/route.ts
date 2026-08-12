import { NextRequest } from 'next/server';
import { eq } from 'drizzle-orm';
import { getDb } from '@/server/db';
import { users } from '@/server/db/schema';
import { requireUser } from '@/server/auth/guards';
import { hashPassword, verifyPassword } from '@/server/auth/password';
import { revokeOtherSessions, requestMeta } from '@/server/auth/session';
import { logSecurityEvent } from '@/server/auth/events';
import { changePasswordSchema } from '@/lib/validation';
import { ok, badRequest, handleError } from '@/lib/api';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  const auth = await requireUser();
  if ('response' in auth) return auth.response;
  try {
    const { currentPassword, newPassword } = changePasswordSchema.parse(await req.json());
    const db = getDb();
    const [row] = await db.select({ passwordHash: users.passwordHash }).from(users).where(eq(users.id, auth.user.id)).limit(1);
    if (!row || !(await verifyPassword(currentPassword, row.passwordHash))) {
      return badRequest('Current password is incorrect.');
    }
    await db.update(users).set({ passwordHash: await hashPassword(newPassword), updatedAt: new Date() }).where(eq(users.id, auth.user.id));
    // Sign out other devices; keep the current session.
    await revokeOtherSessions(auth.user.id);
    const meta = requestMeta(req.headers);
    await logSecurityEvent({ event: 'password.changed', userId: auth.user.id, actorUserId: auth.user.id, ip: meta.ip, userAgent: meta.userAgent });
    return ok({ ok: true });
  } catch (err) {
    return handleError(err, 'auth.change_password');
  }
}
