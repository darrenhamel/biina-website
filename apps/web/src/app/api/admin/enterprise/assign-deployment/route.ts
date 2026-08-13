import { NextRequest } from 'next/server';
import { requireAdmin } from '@/server/auth/guards';
import { handleError, ok } from '@/lib/api';
import { assignDeploymentSchema } from '@/lib/validation';
import { assignDeploymentProfile } from '@/server/enterprise/deployment';

/**
 * Platform admin: assign a deployment profile to an organization. Privileged
 * (sovereign/private-cloud/dedicated) profiles can ONLY be assigned here — never by
 * an organization admin themselves.
 */
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  const auth = await requireAdmin();
  if ('response' in auth) return auth.response;
  try {
    const { organizationId, profileId } = assignDeploymentSchema.parse(await req.json());
    await assignDeploymentProfile(organizationId, profileId, { platformAdmin: true, actorUserId: auth.user.id });
    return ok({ ok: true });
  } catch (err) {
    return handleError(err, 'admin.assign_deployment');
  }
}
