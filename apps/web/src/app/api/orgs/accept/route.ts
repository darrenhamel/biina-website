import { NextRequest, NextResponse } from 'next/server';
import { requireUser } from '@/server/auth/guards';
import { acceptInvitation } from '@/server/org/invitations';
import { tokenSchema } from '@/lib/validation';
import { handleError } from '@/lib/api';

/** POST /api/orgs/accept — accept an org invitation as the authenticated user. */
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  const auth = await requireUser();
  if ('response' in auth) return auth.response;
  try {
    const { token } = tokenSchema.parse(await req.json());
    const result = await acceptInvitation(token, { id: auth.user.id, email: auth.user.email });
    return NextResponse.json(result);
  } catch (err) {
    return handleError(err, 'orgs.accept');
  }
}
