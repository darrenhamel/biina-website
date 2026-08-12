import { NextRequest, NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { getDb } from '@/server/db';
import { users } from '@/server/db/schema';
import { createEmailToken } from '@/server/auth/tokens';
import { requestMeta } from '@/server/auth/session';
import { logSecurityEvent } from '@/server/auth/events';
import { getEmailService, emailTemplates, devLinksEnabled } from '@/server/email';
import { forgotPasswordSchema } from '@/lib/validation';
import { rateLimit, RL } from '@/server/lib/rate-limit';
import { appBaseUrl } from '@/lib/url';
import { ok, handleError } from '@/lib/api';

/**
 * POST /api/auth/forgot-password — ALWAYS returns a generic success (no account
 * enumeration). Sends a reset link only if the account exists.
 */
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  try {
    const meta = requestMeta(req.headers);
    const rl = rateLimit(`forgot:${meta.ip ?? 'unknown'}`, RL.forgot.max, RL.forgot.windowMs);
    if (!rl.allowed) return NextResponse.json({ error: 'Too many attempts. Try again shortly.' }, { status: 429 });

    const { email } = forgotPasswordSchema.parse(await req.json());
    const [user] = await getDb().select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1);

    let devResetLink: string | undefined;
    if (user) {
      const token = await createEmailToken(user.id, 'reset');
      const url = `${appBaseUrl(req)}/en/reset-password?token=${token}`;
      await getEmailService().send({ ...emailTemplates.reset(url), to: email });
      await logSecurityEvent({ event: 'password.reset.requested', userId: user.id, ip: meta.ip, userAgent: meta.userAgent });
      if (devLinksEnabled()) devResetLink = url;
    }
    // Identical response whether or not the account exists.
    return ok({ ok: true, ...(devResetLink ? { devResetLink } : {}) });
  } catch (err) {
    return handleError(err, 'auth.forgot_password');
  }
}
