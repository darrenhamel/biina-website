import { NextRequest } from 'next/server';
import { requireUser } from '@/server/auth/guards';
import { handleError, ok } from '@/lib/api';
import { revokeStandingAuthorization } from '@/server/workflows/standing-auth';

/** DELETE /api/workflows/standing-auth/[id] — revoke immediately; future runs re-check. */
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireUser();
  if ('response' in auth) return auth.response;
  try {
    await revokeStandingAuthorization(auth.user.id, params.id);
    return ok({ ok: true, status: 'REVOKED' });
  } catch (err) {
    return handleError(err, 'workflows.standing_auth.revoke');
  }
}
