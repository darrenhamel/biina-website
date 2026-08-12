import { NextRequest } from 'next/server';
import { requireUser } from '@/server/auth/guards';
import { activeWorkspace } from '@/server/org/workspace';
import { resolveOrgContextById } from '@/server/org/organizations';
import { handleError, ok, forbidden } from '@/lib/api';
import { orgCurationSchema } from '@/lib/validation';
import { clearItemCuration, setItemCuration } from '@/server/library/org';

/** POST /api/library/[id]/curation — org admin recommends / hides / approves an item. */
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireUser();
  if ('response' in auth) return auth.response;
  try {
    const ws = await activeWorkspace(req, auth.user.id);
    if (!ws.organizationId) return forbidden('Select an organization workspace.');
    const ctx = await resolveOrgContextById(auth.user.id, ws.organizationId);
    if (!ctx || (ctx.role !== 'OWNER' && ctx.role !== 'ADMIN')) return forbidden('Organization admin required.');
    const input = orgCurationSchema.parse({ ...(await req.json()), libraryItemId: params.id });
    if (input.state === null) {
      await clearItemCuration(ws.organizationId, params.id, auth.user.id);
      return ok({ ok: true, state: null });
    }
    await setItemCuration(ws.organizationId, params.id, input.state, auth.user.id, input.pinnedVersionId ?? null);
    return ok({ ok: true, state: input.state });
  } catch (err) {
    return handleError(err, 'library.curation');
  }
}
