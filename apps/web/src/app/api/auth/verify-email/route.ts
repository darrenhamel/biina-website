import { NextRequest } from 'next/server';
import { eq } from 'drizzle-orm';
import { getDb } from '@/server/db';
import { users } from '@/server/db/schema';
import { consumeEmailToken } from '@/server/auth/tokens';
import { requestMeta } from '@/server/auth/session';
import { logSecurityEvent } from '@/server/auth/events';
import { tokenSchema } from '@/lib/validation';
import { ok, badRequest, handleError } from '@/lib/api';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  try {
    const { token } = tokenSchema.parse(await req.json());
    const userId = await consumeEmailToken(token, 'verify');
    if (!userId) return badRequest('This verification link is invalid or has expired.');
    await getDb().update(users).set({ emailVerified: true, updatedAt: new Date() }).where(eq(users.id, userId));
    const meta = requestMeta(req.headers);
    await logSecurityEvent({ event: 'email.verified', userId, ip: meta.ip, userAgent: meta.userAgent });
    return ok({ ok: true });
  } catch (err) {
    return handleError(err, 'auth.verify_email');
  }
}
