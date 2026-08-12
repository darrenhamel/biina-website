import { NextRequest } from 'next/server';
import { requireAdmin } from '@/server/auth/guards';
import { handleError, ok } from '@/lib/api';
import { agentPolicySchema } from '@/lib/validation';
import { setAgentPolicy } from '@/server/agent/admin';
import { getDb } from '@/server/db';
import { agentPolicies } from '@/server/db/schema';
import { and, eq, isNull } from 'drizzle-orm';

/**
 * GET/PUT /api/admin/agents/policy — the PLATFORM agent policy (safety ceiling).
 * Platform policy can only tighten defaults; it can disable the agent, disable
 * writes globally, or force tools to REQUIRE_APPROVAL / DENY.
 */
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET() {
  const auth = await requireAdmin();
  if ('response' in auth) return auth.response;
  try {
    const [row] = await getDb().select().from(agentPolicies).where(and(eq(agentPolicies.scope, 'PLATFORM'), isNull(agentPolicies.scopeId))).limit(1);
    return ok({ policy: row ?? null });
  } catch (err) {
    return handleError(err, 'admin.agents.policy.get');
  }
}

export async function PUT(req: NextRequest) {
  const auth = await requireAdmin();
  if ('response' in auth) return auth.response;
  try {
    const patch = agentPolicySchema.parse(await req.json());
    await setAgentPolicy({ scope: 'PLATFORM', scopeId: null, updatedByUserId: auth.user.id, patch });
    return ok({ ok: true });
  } catch (err) {
    return handleError(err, 'admin.agents.policy.set');
  }
}
