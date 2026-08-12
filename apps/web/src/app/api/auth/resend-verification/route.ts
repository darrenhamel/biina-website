import { NextRequest, NextResponse } from 'next/server';
import { requireUser } from '@/server/auth/guards';
import { createEmailToken } from '@/server/auth/tokens';
import { getEmailService, emailTemplates, devLinksEnabled } from '@/server/email';
import { rateLimit, RL } from '@/server/lib/rate-limit';
import { requestMeta } from '@/server/auth/session';
import { appBaseUrl } from '@/lib/url';
import { ok, handleError } from '@/lib/api';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  const auth = await requireUser();
  if ('response' in auth) return auth.response;
  try {
    if (auth.user.emailVerified) return ok({ ok: true, alreadyVerified: true });
    const meta = requestMeta(req.headers);
    const rl = rateLimit(`verify-resend:${auth.user.id}`, RL.verifyResend.max, RL.verifyResend.windowMs);
    if (!rl.allowed) return NextResponse.json({ error: 'Please wait before requesting another email.' }, { status: 429 });

    const token = await createEmailToken(auth.user.id, 'verify');
    const url = `${appBaseUrl(req)}/en/verify-email?token=${token}`;
    await getEmailService().send({ ...emailTemplates.verify(url), to: auth.user.email });
    return ok({ ok: true, ...(devLinksEnabled() ? { devVerifyLink: url } : {}) });
  } catch (err) {
    return handleError(err, 'auth.resend_verification');
  }
}
