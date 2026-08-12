import { NextRequest, NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { getDb } from '@/server/db';
import { users, profiles } from '@/server/db/schema';
import { hashPassword } from '@/server/auth/password';
import { createSession, requestMeta } from '@/server/auth/session';
import { logSecurityEvent } from '@/server/auth/events';
import { createEmailToken } from '@/server/auth/tokens';
import { getEmailService, emailTemplates, devLinksEnabled } from '@/server/email';
import { signupSchema } from '@/lib/validation';
import { rateLimit, RL } from '@/server/lib/rate-limit';
import { appBaseUrl } from '@/lib/url';
import { ok, badRequest, handleError } from '@/lib/api';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  try {
    const meta = requestMeta(req.headers);
    const rl = rateLimit(`signup:${meta.ip ?? 'unknown'}`, RL.signup.max, RL.signup.windowMs);
    if (!rl.allowed) {
      return NextResponse.json({ error: 'Too many attempts. Please try again shortly.' }, { status: 429 });
    }

    const { displayName, email, password } = signupSchema.parse(await req.json());
    const db = getDb();

    const existing = await db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1);
    if (existing.length > 0) {
      // Generic-ish (a signup form inherently reveals existence; keep it simple).
      return badRequest('An account with that email already exists.');
    }

    const passwordHash = await hashPassword(password);
    // New users get the configured default plan (FREE) via the column default.
    const [user] = await db.insert(users).values({ email, passwordHash }).returning({ id: users.id });
    await db.insert(profiles).values({ userId: user.id, displayName });

    await createSession(user.id, meta);
    await logSecurityEvent({ event: 'account.created', userId: user.id, actorUserId: user.id, ip: meta.ip, userAgent: meta.userAgent });

    // Email verification (architecture works without a live email service).
    let devVerifyLink: string | undefined;
    try {
      const token = await createEmailToken(user.id, 'verify');
      const url = `${appBaseUrl(req)}/en/verify-email?token=${token}`;
      await getEmailService().send({ ...emailTemplates.verify(url), to: email });
      if (devLinksEnabled()) devVerifyLink = url;
    } catch {
      /* verification email is best-effort */
    }

    return ok({ ok: true, ...(devVerifyLink ? { devVerifyLink } : {}) }, { status: 201 });
  } catch (err) {
    return handleError(err, 'auth.signup');
  }
}
