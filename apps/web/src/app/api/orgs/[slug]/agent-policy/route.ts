import { NextRequest } from 'next/server';
import { requireUser } from '@/server/auth/guards';
import { resolveOrgContext } from '@/server/org/organizations';
import { isOrgManager } from '@/server/auth/permissions';
import { handleError, ok, notFound, forbidden } from '@/lib/api';
import { agentPolicySchema } from '@/lib/validation';
import { setAgentPolicy } from '@/server/agent/admin';
import { getDb } from '@/server/db';
import { agentPolicies } from '@/server/db/schema';
import { and, eq } from 'drizzle-orm';

/**
 * GET/PUT /api/orgs/[slug]/agent-policy — an ORGANIZATION's agent policy. Managers
 * can restrict their members (disable the agent, disable email/calendar/slack/crm
 * writes, force approval). Org policy can only be MORE restrictive than platform.
 */
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(_req: NextRequest, { params }: { params: { slug: string } }) {
  const auth = await requireUser();
  if ('response' in auth) return auth.response;
  try {
    const ctx = await resolveOrgContext(auth.user.id, params.slug);
    if (!ctx) return notFound('Organization not found');
    if (!isOrgManager(ctx.role)) return forbidden('Managers only.');
    const [row] = await getDb().select().from(agentPolicies).where(and(eq(agentPolicies.scope, 'ORGANIZATION'), eq(agentPolicies.scopeId, ctx.org.id))).limit(1);
    return ok({ policy: row ?? null });
  } catch (err) {
    return handleError(err, 'org.agent.policy.get');
  }
}

export async function PUT(req: NextRequest, { params }: { params: { slug: string } }) {
  const auth = await requireUser();
  if ('response' in auth) return auth.response;
  try {
    const ctx = await resolveOrgContext(auth.user.id, params.slug);
    if (!ctx) return notFound('Organization not found');
    if (!isOrgManager(ctx.role)) return forbidden('Managers only.');
    const patch = agentPolicySchema.parse(await req.json());
    await setAgentPolicy({ scope: 'ORGANIZATION', scopeId: ctx.org.id, updatedByUserId: auth.user.id, patch });
    return ok({ ok: true });
  } catch (err) {
    return handleError(err, 'org.agent.policy.set');
  }
}
