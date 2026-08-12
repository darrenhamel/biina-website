import { and, eq, isNull } from 'drizzle-orm';
import { getDb } from '@/server/db';
import { agentPolicies } from '@/server/db/schema';
import type { AgentPolicy } from '@/server/db/schema';

/**
 * Agent policy storage + effective-policy resolution.
 *
 * Policies exist at three scopes — PLATFORM (ceiling), ORGANIZATION, USER. The
 * EFFECTIVE policy is the MOST RESTRICTIVE combination: a stricter scope can only
 * turn capabilities OFF or raise a tool to REQUIRE_APPROVAL / DENY — it can never
 * loosen a safety boundary. Precedence: Platform → Organization → User.
 */

export interface EffectivePolicy {
  agentEnabled: boolean;
  writeActionsEnabled: boolean;
  emailSendingEnabled: boolean;
  calendarActionsEnabled: boolean;
  slackPostingEnabled: boolean;
  crmWritesEnabled: boolean;
  maxStepsPerSession: number | null;
  /** Merged per-tool overrides (most restrictive across scopes). */
  toolOverrides: Record<string, 'ALLOW' | 'REQUIRE_APPROVAL' | 'DENY'>;
  crossConnectorTransfer: 'ALLOW' | 'REQUIRE_APPROVAL' | 'DENY';
}

const PERMISSIVE_BASE: EffectivePolicy = {
  agentEnabled: true,
  writeActionsEnabled: true,
  emailSendingEnabled: true,
  calendarActionsEnabled: true,
  slackPostingEnabled: true,
  crmWritesEnabled: true,
  maxStepsPerSession: null,
  toolOverrides: {},
  crossConnectorTransfer: 'REQUIRE_APPROVAL', // conservative default: never silent
};

const RANK: Record<string, number> = { ALLOW: 0, REQUIRE_APPROVAL: 1, DENY: 2 };
function moreRestrictive(a: string, b: string): 'ALLOW' | 'REQUIRE_APPROVAL' | 'DENY' {
  return (RANK[a] >= RANK[b] ? a : b) as 'ALLOW' | 'REQUIRE_APPROVAL' | 'DENY';
}

/** Fold one scope's policy row onto the accumulator (can only tighten). */
function applyPolicy(acc: EffectivePolicy, p: AgentPolicy | null): EffectivePolicy {
  if (!p) return acc;
  const andFlag = (cur: boolean, val: boolean | null) => (val === false ? false : cur);
  const next: EffectivePolicy = {
    agentEnabled: andFlag(acc.agentEnabled, p.agentEnabled),
    writeActionsEnabled: andFlag(acc.writeActionsEnabled, p.writeActionsEnabled),
    emailSendingEnabled: andFlag(acc.emailSendingEnabled, p.emailSendingEnabled),
    calendarActionsEnabled: andFlag(acc.calendarActionsEnabled, p.calendarActionsEnabled),
    slackPostingEnabled: andFlag(acc.slackPostingEnabled, p.slackPostingEnabled),
    crmWritesEnabled: andFlag(acc.crmWritesEnabled, p.crmWritesEnabled),
    maxStepsPerSession:
      p.maxStepsPerSession == null
        ? acc.maxStepsPerSession
        : acc.maxStepsPerSession == null
          ? p.maxStepsPerSession
          : Math.min(acc.maxStepsPerSession, p.maxStepsPerSession),
    toolOverrides: { ...acc.toolOverrides },
    crossConnectorTransfer: p.crossConnectorTransfer
      ? moreRestrictive(acc.crossConnectorTransfer, p.crossConnectorTransfer)
      : acc.crossConnectorTransfer,
  };
  for (const [tool, decision] of Object.entries(p.toolOverrides ?? {})) {
    const prev = next.toolOverrides[tool] ?? 'ALLOW';
    next.toolOverrides[tool] = moreRestrictive(prev, decision);
  }
  return next;
}

async function loadPolicyRow(scope: 'PLATFORM' | 'ORGANIZATION' | 'USER', scopeId: string | null): Promise<AgentPolicy | null> {
  const where = scopeId
    ? and(eq(agentPolicies.scope, scope), eq(agentPolicies.scopeId, scopeId))
    : and(eq(agentPolicies.scope, scope), isNull(agentPolicies.scopeId));
  const [row] = await getDb().select().from(agentPolicies).where(where).limit(1);
  return row ?? null;
}

/**
 * Pure merge (Platform → Organization → User): each layer can only TIGHTEN. Split
 * out so the precedence rule is unit-testable without a database.
 */
export function combinePolicies(platform: AgentPolicy | null, org: AgentPolicy | null, user: AgentPolicy | null): EffectivePolicy {
  return applyPolicy(applyPolicy(applyPolicy({ ...PERMISSIVE_BASE, toolOverrides: {} }, platform), org), user);
}

/** Resolve the effective (most-restrictive) policy for a user in an org context. */
export async function resolveEffectivePolicy(input: { userId: string; organizationId: string | null }): Promise<EffectivePolicy> {
  const [platform, org, user] = await Promise.all([
    loadPolicyRow('PLATFORM', null),
    input.organizationId ? loadPolicyRow('ORGANIZATION', input.organizationId) : Promise.resolve(null),
    loadPolicyRow('USER', input.userId),
  ]);
  return combinePolicies(platform, org, user);
}

/** Upsert a policy row for a scope (admin/org-manager/user preference). */
export async function upsertAgentPolicy(input: {
  scope: 'PLATFORM' | 'ORGANIZATION' | 'USER';
  scopeId: string | null;
  updatedByUserId: string;
  patch: Partial<Omit<AgentPolicy, 'id' | 'scope' | 'scopeId' | 'createdAt' | 'updatedAt'>>;
}): Promise<void> {
  const db = getDb();
  const existing = await loadPolicyRow(input.scope, input.scopeId);
  if (existing) {
    await db
      .update(agentPolicies)
      .set({ ...input.patch, updatedByUserId: input.updatedByUserId, updatedAt: new Date() })
      .where(eq(agentPolicies.id, existing.id));
  } else {
    await db.insert(agentPolicies).values({ scope: input.scope, scopeId: input.scopeId, updatedByUserId: input.updatedByUserId, ...input.patch });
  }
}
