import { NextRequest } from 'next/server';
import { requireUser } from '@/server/auth/guards';
import { activeWorkspace } from '@/server/org/workspace';
import { handleError, ok } from '@/lib/api';
import { updateInstallSchema } from '@/lib/validation';
import { uninstall } from '@/server/library/installations';
import { previewUpdate, updateInstallation } from '@/server/library/updates';

/**
 * GET    /api/library/installations/[id] — preview an available version update (diff).
 * PATCH  /api/library/installations/[id] — apply an update (security-sensitive needs confirm).
 * DELETE /api/library/installations/[id] — uninstall (disable local instance; no OAuth change).
 */
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireUser();
  if ('response' in auth) return auth.response;
  try {
    const ws = await activeWorkspace(req, auth.user.id);
    const preview = await previewUpdate({ userId: auth.user.id, activeOrganizationId: ws.organizationId }, params.id);
    return ok({ update: preview });
  } catch (err) {
    return handleError(err, 'library.install.preview');
  }
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireUser();
  if ('response' in auth) return auth.response;
  try {
    const ws = await activeWorkspace(req, auth.user.id);
    const body = await req.json().catch(() => ({}));
    const { confirm } = updateInstallSchema.parse(body);
    const res = await updateInstallation({ userId: auth.user.id, activeOrganizationId: ws.organizationId }, params.id, confirm === true);
    return ok(res);
  } catch (err) {
    return handleError(err, 'library.install.update');
  }
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireUser();
  if ('response' in auth) return auth.response;
  try {
    const ws = await activeWorkspace(req, auth.user.id);
    await uninstall({ userId: auth.user.id, activeOrganizationId: ws.organizationId }, params.id);
    return ok({ ok: true });
  } catch (err) {
    return handleError(err, 'library.uninstall');
  }
}
