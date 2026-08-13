import { NextRequest } from 'next/server';
import { requireUser } from '@/server/auth/guards';
import { handleError, ok } from '@/lib/api';
import { securityPolicySchema } from '@/lib/validation';
import { requireOrgPermission } from '@/server/enterprise/guard';
import { getSecurityPolicyRow, updateSecurityPolicy, HIGH_RISK_POLICY_FIELDS } from '@/server/enterprise/policy-store';
import { resolveOrgGovernance } from '@/server/enterprise/deployment';
import { AppError } from '@/lib/errors';

/** GET/PUT the organization security policy (raw row + effective folded view). */
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const auth = await requireUser();
  if ('response' in auth) return auth.response;
  try {
    const access = await requireOrgPermission(req, auth.user.id, 'security.read');
    const row = await getSecurityPolicyRow(access.organizationId);
    const gov = await resolveOrgGovernance(access.organizationId);
    return ok({ policy: row, effective: gov.policy, deploymentProfile: gov.deploymentProfile ? { slug: gov.deploymentProfile.slug, deploymentType: gov.deploymentProfile.deploymentType, region: gov.deploymentProfile.region } : null });
  } catch (err) {
    return handleError(err, 'org.security_policy.get');
  }
}

export async function PUT(req: NextRequest) {
  const auth = await requireUser();
  if ('response' in auth) return auth.response;
  try {
    const access = await requireOrgPermission(req, auth.user.id, 'security.manage');
    const { confirm, ...patch } = securityPolicySchema.parse(await req.json());
    // A high-risk change (enabling external AI / external writes) requires explicit confirm.
    const touchesHighRisk = HIGH_RISK_POLICY_FIELDS.some((f) => f in patch);
    if (touchesHighRisk && confirm !== true) throw new AppError(409, 'This change is security-sensitive and requires explicit confirmation.', 'confirm_required');
    const row = await updateSecurityPolicy(access.organizationId, patch, auth.user.id);
    return ok({ policy: row });
  } catch (err) {
    return handleError(err, 'org.security_policy.update');
  }
}
