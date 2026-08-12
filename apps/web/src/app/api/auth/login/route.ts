import { NextRequest, NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { getDb } from '@/server/db';
import { users } from '@/server/db/schema';
import { verifyPassword } from '@/server/auth/password';
import { createSession, requestMeta } from '@/server/auth/session';
import { logSecurityEvent } from '@/server/auth/events';
import { loginSchema } from '@/lib/validation';
import { rateLimit, RL } from '@/server/lib/rate-limit';
import { ok, unauthorized, handleError } from '@/lib/api';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  try {
    const meta = requestMeta(req.headers);
    const rl = rateLimit(`login:${meta.ip ?? 'unknown'}`, RL.login.max, RL.login.windowMs);
    if (!rl.allowed) {
      return NextResponse.json({ error: 'Too many attempts. Please try again shortly.' }, { status: 429, headers: { 'Retry-After': String(rl.retryAfterSec ?? 60) } });
    }

    const { email, password } = loginSchema.parse(await req.json());
    const db = getDb();

    const [user] = await db
      .select({ id: users.id, passwordHash: users.passwordHash, status: users.status })
      .from(users)
      .where(eq(users.email, email))
      .limit(1);

    // Same generic response whether the email exists or the password is wrong.
    if (!user || !(await verifyPassword(password, user.passwordHash))) {
      await logSecurityEvent({ event: 'login.failure', userId: user?.id ?? null, ip: meta.ip, userAgent: meta.userAgent, metadata: { email } });
      return unauthorized('Incorrect email or password.');
    }

    // Suspended/disabled accounts cannot log in — generic message (no enumeration of state).
    if (user.status !== 'ACTIVE') {
      await logSecurityEvent({ event: 'login.failure', userId: user.id, ip: meta.ip, userAgent: meta.userAgent, metadata: { reason: 'not_active' } });
      return unauthorized('This account is not available. Contact support.');
    }

    await createSession(user.id, meta);
    await logSecurityEvent({ event: 'login.success', userId: user.id, actorUserId: user.id, ip: meta.ip, userAgent: meta.userAgent });
    return ok({ ok: true });
  } catch (err) {
    return handleError(err, 'auth.login');
  }
}
