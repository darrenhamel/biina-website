import { NextRequest } from 'next/server';
import { requireUser } from '@/server/auth/guards';
import { activeWorkspace } from '@/server/org/workspace';
import { handleError, ok, notFound, forbidden } from '@/lib/api';
import { createVersionSchema } from '@/lib/validation';
import { resolveItemAccess } from '@/server/library/access';
import { createVersion } from '@/server/library/versions';
import type { LibraryItemType } from '@/server/library/types';

/** POST /api/library/[id]/versions — add a new DRAFT version (revalidated). */
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireUser();
  if ('response' in auth) return auth.response;
  try {
    const ws = await activeWorkspace(req, auth.user.id);
    const viewer = { userId: auth.user.id, activeOrganizationId: ws.organizationId };
    const access = await resolveItemAccess(viewer, params.id);
    if (!access) return notFound('Item not found.');
    if (!access.canManage) return forbidden('You cannot modify this item.');
    const input = createVersionSchema.parse(await req.json());
    const { version, validation } = await createVersion(access.item, {
      itemType: access.item.itemType as LibraryItemType,
      definition: input.definition,
      changeNotes: input.changeNotes ?? null,
      supportedPersonas: input.supportedPersonas,
      requiredPlans: input.requiredPlans,
      createdByUserId: auth.user.id,
    });
    return ok({ versionId: version.id, version: version.version, validation: { ok: validation.ok, riskLevel: validation.riskLevel, flags: validation.flags } });
  } catch (err) {
    return handleError(err, 'library.version.create');
  }
}
