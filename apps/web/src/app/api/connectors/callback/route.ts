import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/server/auth/session';
import { completeOAuth } from '@/server/connectors/oauth';
import { logger } from '@/lib/logger';

/**
 * GET /api/connectors/callback — OAuth redirect target. Validates state + code
 * against the AUTHENTICATED session (defends OAuth CSRF / account-linking), then
 * redirects to the connections settings page. Never trusts arbitrary redirect
 * params — the destination is fixed to our own settings route.
 */
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const settings = new URL('/en/app/settings/connections', req.nextUrl.origin);
  try {
    const user = await getCurrentUser();
    const state = req.nextUrl.searchParams.get('state');
    const code = req.nextUrl.searchParams.get('code');
    const error = req.nextUrl.searchParams.get('error');
    if (error || !state || !code || !user) {
      settings.searchParams.set('connect', 'error');
      return NextResponse.redirect(settings);
    }
    await completeOAuth(state, code, user.id);
    settings.searchParams.set('connect', 'success');
    return NextResponse.redirect(settings);
  } catch (err) {
    logger.warn('connectors.callback.failed', { error: String(err) });
    settings.searchParams.set('connect', 'error');
    return NextResponse.redirect(settings);
  }
}
