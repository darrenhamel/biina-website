import { NextResponse } from 'next/server';
import { requireUser } from '@/server/auth/guards';
import { listSessions } from '@/server/auth/session';
import { handleError } from '@/lib/api';

/** GET /api/auth/sessions — the user's active sessions (no raw IPs surfaced). */
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET() {
  const auth = await requireUser();
  if ('response' in auth) return auth.response;
  try {
    const sessions = await listSessions(auth.user.id);
    // Surface coarse, non-invasive fields only.
    return NextResponse.json({
      sessions: sessions.map((s) => ({
        id: s.id,
        current: s.current,
        createdAt: s.createdAt,
        lastUsedAt: s.lastUsedAt,
        userAgent: s.userAgent,
      })),
    });
  } catch (err) {
    return handleError(err, 'auth.sessions.list');
  }
}
