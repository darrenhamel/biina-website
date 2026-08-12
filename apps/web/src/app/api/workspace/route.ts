import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireUser } from '@/server/auth/guards';
import { resolveOrgContext } from '@/server/org/organizations';
import { WORKSPACE_COOKIE } from '@/server/org/constants';
import { handleError, badRequest } from '@/lib/api';

/**
 * POST /api/workspace — set the active workspace ('personal' or an org slug).
 * Membership is VERIFIED here before the cookie is set; the cookie is only a hint
 * (every AI request re-verifies).
 */
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const bodySchema = z.object({ workspace: z.string().max(48) });

export async function POST(req: NextRequest) {
  const auth = await requireUser();
  if ('response' in auth) return auth.response;
  try {
    const { workspace } = bodySchema.parse(await req.json());
    if (workspace !== 'personal') {
      const ctx = await resolveOrgContext(auth.user.id, workspace);
      if (!ctx) return badRequest('You are not a member of that workspace.');
    }
    const res = NextResponse.json({ ok: true, workspace });
    res.cookies.set(WORKSPACE_COOKIE, workspace, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      path: '/',
      maxAge: 60 * 60 * 24 * 365,
    });
    return res;
  } catch (err) {
    return handleError(err, 'workspace.set');
  }
}
