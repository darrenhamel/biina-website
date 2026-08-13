import { NextRequest } from 'next/server';
import { handleError, ok } from '@/lib/api';
import { authenticateScim, provisionUser, deactivateUser } from '@/server/enterprise/scim';
import { scimEnabled } from '@/server/enterprise/config';
import { AppError } from '@/lib/errors';

/**
 * SCIM 2.0 Users endpoint. The bearer token scopes ALL operations to one organization
 * — a token can never provision/deactivate users in another tenant. POST provisions;
 * PATCH sets active=false (deprovision) which stops org access but keeps the personal
 * account + data intact.
 */
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
    const body = (await req.json()) as { userName?: string; displayName?: string; externalId?: string; active?: boolean };
    if (!body.userName) throw new AppError(400, 'userName is required.', 'scim_bad_user');
    const res = await provisionUser(organizationId, { userName: body.userName, displayName: body.displayName, externalId: body.externalId, active: body.active });
    return ok({ id: res.membershipId, userId: res.userId, active: body.active !== false, meta: { resourceType: 'User', created: res.created } }, { status: 201 });
  } catch (err) {
    return handleError(err, 'scim.users.create');
  }
}

export async function PATCH(req: NextRequest) {
  try {
    if (!scimEnabled()) throw new AppError(403, 'SCIM is not enabled.', 'scim_disabled');
    const organizationId = await authenticateScim(bearer(req));
    const body = (await req.json()) as { externalId?: string; userName?: string; active?: boolean };
    const key = body.externalId ?? body.userName;
    if (!key) throw new AppError(400, 'externalId or userName required.', 'scim_bad_user');
    if (body.active === false) {
      const res = await deactivateUser(organizationId, key);
      return ok({ deactivated: res.deactivated, active: false });
    }
    // Reactivation via re-provision.
    if (body.userName) {
      const res = await provisionUser(organizationId, { userName: body.userName, externalId: body.externalId, active: true });
      return ok({ id: res.membershipId, active: true });
    }
    throw new AppError(400, 'Unsupported PATCH.', 'scim_unsupported');
  } catch (err) {
    return handleError(err, 'scim.users.patch');
  }
}
