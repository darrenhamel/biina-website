import { NextRequest } from 'next/server';
import { eq } from 'drizzle-orm';
import { requireUser } from '@/server/auth/guards';
import { getDb } from '@/server/db';
import { dataResidencyPolicies } from '@/server/db/schema';
import { handleError, ok, forbidden } from '@/lib/api';
import { residencyPolicySchema } from '@/lib/validation';
import { requireOrgPermission } from '@/server/enterprise/guard';
import { resolveOrgGovernance } from '@/server/enterprise/deployment';
import { getPlan } from '@/server/ai/plans';
import { logSecurityEvent } from '@/server/auth/events';

/** GET/PUT the org data-residency policy (gated by the dataResidencyControls entitlement). */
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const auth = await requireUser();
  if ('response' in auth) return auth.response;
  try {
    const access = await requireOrgPermission(req, auth.user.id, 'security.read');
    const [row] = await getDb().select().from(dataResidencyPolicies).where(eq(dataResidencyPolicies.organizationId, access.organizationId)).limit(1);
    const gov = await resolveOrgGovernance(access.organizationId);
    return ok({ policy: row ?? null, effective: gov.residency });
  } catch (err) {
    return handleError(err, 'org.residency.get');
  }
}

export async function PUT(req: NextRequest) {
  const auth = await requireUser();
  if ('response' in auth) return auth.response;
  try {
    const access = await requireOrgPermission(req, auth.user.id, 'security.manage');
    const plan = await getPlan(auth.user.plan);
    if (!plan.dataResidencyControls) return forbidden('Your plan does not include data-residency controls.');
    const patch = residencyPolicySchema.parse(await req.json());
    const db = getDb();
    const [existing] = await db.select().from(dataResidencyPolicies).where(eq(dataResidencyPolicies.organizationId, access.organizationId)).limit(1);
    let row;
    if (existing) [row] = await db.update(dataResidencyPolicies).set({ ...patch, updatedAt: new Date() }).where(eq(dataResidencyPolicies.id, existing.id)).returning();
    else [row] = await db.insert(dataResidencyPolicies).values({ organizationId: access.organizationId, name: patch.name ?? 'Organization residency', ...patch }).returning();
    await logSecurityEvent({ event: 'enterprise.residency_changed', actorUserId: auth.user.id, organizationId: access.organizationId, metadata: { changed: Object.keys(patch) } });
    return ok({ policy: row });
  } catch (err) {
    return handleError(err, 'org.residency.update');
  }
}
