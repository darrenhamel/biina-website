import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireUser } from '@/server/auth/guards';
import { activeWorkspace } from '@/server/org/workspace';
import { revokeConnection } from '@/server/connectors/connections';
import { handleError } from '@/lib/api';

/** DELETE /api/connections/[id] — disconnect (revoke + delete credential). */
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const idSchema = z.string().uuid();

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireUser();
  if ('response' in auth) return auth.response;
  try {
    const id = idSchema.parse(params.id);
    const ws = await activeWorkspace(req, auth.user.id);
    return NextResponse.json(await revokeConnection(auth.user.id, id, ws.organizationId));
  } catch (err) {
    return handleError(err, 'connections.revoke');
  }
}
