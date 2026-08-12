import { NextRequest } from 'next/server';
import { requireUser } from '@/server/auth/guards';
import { activeWorkspace } from '@/server/org/workspace';
import { handleError, ok } from '@/lib/api';
import { listInstallations } from '@/server/library/installations';

/** GET /api/library/installations — the caller's installed library items in scope. */
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const auth = await requireUser();
  if ('response' in auth) return auth.response;
  try {
    const ws = await activeWorkspace(req, auth.user.id);
    const rows = await listInstallations({ userId: auth.user.id, activeOrganizationId: ws.organizationId });
    return ok({
      installations: rows.map((r) => ({
        id: r.id,
        libraryItemId: r.libraryItemId,
        versionId: r.versionId,
        installedDefinitionType: r.installedDefinitionType,
        installedDefinitionId: r.installedDefinitionId,
        status: r.status,
        pinnedVersion: r.pinnedVersion,
        installedAt: r.installedAt,
      })),
    });
  } catch (err) {
    return handleError(err, 'library.installations');
  }
}
