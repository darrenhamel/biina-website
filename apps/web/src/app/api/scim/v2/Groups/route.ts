import { NextRequest } from 'next/server';
import { handleError, ok } from '@/lib/api';
import { authenticateScim, provisionGroup } from '@/server/enterprise/scim';
import { scimEnabled } from '@/server/enterprise/config';
import { AppError } from '@/lib/errors';

/** SCIM 2.0 Groups endpoint (tenant-scoped by the bearer token). */
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function bearer(req: NextRequest): string | null {
  const h = req.headers.get('authorization') ?? '';
  return h.toLowerCase().startsWith('bearer ') ? h.slice(7).trim() : null;
}

export async function POST(req: NextRequest) {
  try {
    if (!scimEnabled()) throw new AppError(403, 'SCIM is not enabled.', 'scim_disabled');
    const organizationId = await authenticateScim(bearer(req));
    const body = (await req.json()) as { displayName?: string; externalId?: string };
    if (!body.displayName) throw new AppError(400, 'displayName is required.', 'scim_bad_group');
    const res = await provisionGroup(organizationId, { displayName: body.displayName, externalId: body.externalId });
    return ok({ id: res.groupId, meta: { resourceType: 'Group' } }, { status: 201 });
  } catch (err) {
    return handleError(err, 'scim.groups.create');
  }
}
