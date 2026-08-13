import { NextRequest } from 'next/server';
import { requireUser } from '@/server/auth/guards';
import { handleError, ok } from '@/lib/api';
import { retentionPolicySchema } from '@/lib/validation';
import { requireOrgPermission } from '@/server/enterprise/guard';
import { resolveRetention, upsertRetention } from '@/server/enterprise/retention';

/** GET/PUT the org retention policy (effective view clamps to platform minimums). */
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const auth = await requireUser();
  if ('response' in auth) return auth.response;
  try {
    const access = await requireOrgPermission(req, auth.user.id, 'retention.read');
    const effective = await resolveRetention({ organizationId: access.organizationId });
    return ok({ effective });
  } catch (err) {
    return handleError(err, 'org.retention.get');
  }
}

export async function PUT(req: NextRequest) {
  const auth = await requireUser();
  if ('response' in auth) return auth.response;
  try {
    const access = await requireOrgPermission(req, auth.user.id, 'retention.manage');
    const patch = retentionPolicySchema.parse(await req.json());
    const row = await upsertRetention(access.organizationId, patch, auth.user.id);
    const effective = await resolveRetention({ organizationId: access.organizationId });
    return ok({ policy: row, effective });
  } catch (err) {
    return handleError(err, 'org.retention.update');
  }
}
