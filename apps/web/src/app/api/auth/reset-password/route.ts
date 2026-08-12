import { NextRequest, NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { getDb } from '@/server/db';
import { users } from '@/server/db/schema';
import { consumeEmailToken } from '@/server/auth/tokens';
import { hashPassword } from '@/server/auth/password';
import { revokeAllSessions, requestMeta } from '@/server/auth/session';
import { logSecurityEvent } from '@/server/auth/events';
import { resetPasswordSchema } from '@/lib/validation';
import { rateLimit, RL } from '@/server/lib/rate-limit';
import { ok, badRequest, handleError } from '@/lib/api';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  try {
    const meta = requestMeta(req.headers);
    const rl = rateLimit(`reset:${meta.ip ?? 'unknown'}`, RL.reset.max, RL.reset.windowMs);
    if (!rl.allowed) return NextResponse.json({ error: 'Too many attempts. Try again shortly.' }, { status: 429 });

    const { token, newPassword } = resetPasswordSchema.parse(await req.json());
    // Atomic single-use consume — a second concurrent request gets null.
    const userId = await consumeEmailToken(token, 'reset');
    if (!userId) return badRequest('This reset link is invalid or has expired.');

    await getDb().update(users).set({ passwordHash: await hashPassword(newPassword), updatedAt: new Date() }).where(eq(users.id, userId));
    // Invalidate all sessions after a reset.
    await revokeAllSessions(userId);
    await logSecurityEvent({ event: 'password.reset.completed', userId, ip: meta.ip, userAgent: meta.userAgent });
    return ok({ ok: true });
  } catch (err) {
    return handleError(err, 'auth.reset_password');
  }
}
