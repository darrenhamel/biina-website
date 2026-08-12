import { and, eq, gte, gt, sql } from 'drizzle-orm';
import { getDb } from '@/server/db';
import { standingAuthorizations, agentActions, agentSessions } from '@/server/db/schema';
import type { StandingAuthorization } from '@/server/db/schema';
import { logSecurityEvent } from '@/server/auth/events';
import { getAgentTool, type AgentTool } from '@/server/agent/tool-catalog';
import { badRequest, forbidden, notFound } from '@/lib/errors';

/**
 * Standing authorizations — the ONLY way a scheduled external write runs without a
 * per-run human approval. Deliberately NARROW: bound to a single tool + connection
 * + workflow + an exact destination allowlist + execution limits + expiry. Creating
 * one is itself an explicit, authenticated user action (never inferred); revoking
 * is immediate and every future run re-checks. Consumption is atomic so limits can
 * never be exceeded by concurrent runs.
 */

/** The external destinations an action targets (what a standing auth must cover). */
export function actionDestinations(tool: AgentTool, args: Record<string, unknown>): string[] {
  switch (tool.previewKind) {
    case 'email':
    case 'draft':
      return [...(((args.to as string[]) ?? [])), ...(((args.cc as string[]) ?? []))].map((s) => String(s).toLowerCase());
    case 'slack':
      return args.channel ? [String(args.channel)] : [];
    case 'calendar':
      return ((args.guests as string[]) ?? []).map((s) => String(s).toLowerCase());
    case 'crm':
      return args.recordId ? [String(args.recordId)] : [];
    default:
      return [];
  }
}

const RISK_RANK: Record<string, number> = { READ_ONLY: 0, REVERSIBLE_WRITE: 1, EXTERNAL_COMMUNICATION: 2, HIGH_RISK: 3, FINANCIAL_OR_COMMITMENT: 4, DESTRUCTIVE: 5 };

async function executionsToday(auth: StandingAuthorization): Promise<number> {
  const day = new Date(); day.setUTCHours(0, 0, 0, 0);
  const [r] = await getDb()
    .select({ n: sql<number>`count(*)::int` })
    .from(agentActions)
    .innerJoin(agentSessions, eq(agentActions.agentSessionId, agentSessions.id))
    .where(and(eq(agentActions.connectionId, auth.connectionId), eq(agentActions.toolId, auth.toolId), eq(agentActions.status, 'SUCCEEDED'), gte(agentActions.executedAt, day), eq(agentSessions.userId, auth.userId)));
  return r?.n ?? 0;
}

/**
 * Find an ACTIVE standing authorization that fully covers this action, or null.
 * Requires: same workflow + tool + connection, unexpired, risk within ceiling,
 * EVERY destination in the allowlist, and remaining total/day executions.
 */
export async function matchStandingAuthorization(input: {
  workflowId: string;
  userId: string;
  organizationId: string | null;
  tool: AgentTool;
  args: Record<string, unknown>;
  connectionId: string;
}): Promise<StandingAuthorization | null> {
  const rows = await getDb()
    .select()
    .from(standingAuthorizations)
    .where(and(eq(standingAuthorizations.workflowId, input.workflowId), eq(standingAuthorizations.toolId, input.tool.id), eq(standingAuthorizations.connectionId, input.connectionId), eq(standingAuthorizations.status, 'ACTIVE'), gt(standingAuthorizations.expiresAt, new Date())));

  const dests = actionDestinations(input.tool, input.args);
  for (const auth of rows) {
    if (auth.userId !== input.userId) continue;
    if ((auth.organizationId ?? null) !== (input.organizationId ?? null)) continue;
    if (RISK_RANK[input.tool.risk] > (RISK_RANK[auth.riskCeiling] ?? 0)) continue;
    const allow = new Set((auth.allowedDestinations ?? []).map((s) => s.toLowerCase()));
    if (dests.length === 0 || !dests.every((d) => allow.has(d))) continue; // exact destination binding
    if (auth.maxExecutions != null && auth.executionsUsed >= auth.maxExecutions) continue;
    if (auth.maxExecutionsPerDay != null && (await executionsToday(auth)) >= auth.maxExecutionsPerDay) continue;
    return auth;
  }
  return null;
}

/** Atomically consume one execution. Returns true only if a slot was available. */
export async function consumeStandingAuthorization(authId: string): Promise<boolean> {
  const [row] = await getDb()
    .update(standingAuthorizations)
    .set({ executionsUsed: sql`${standingAuthorizations.executionsUsed} + 1` })
    .where(and(eq(standingAuthorizations.id, authId), eq(standingAuthorizations.status, 'ACTIVE'), gt(standingAuthorizations.expiresAt, new Date()), sql`(${standingAuthorizations.maxExecutions} is null or ${standingAuthorizations.executionsUsed} < ${standingAuthorizations.maxExecutions})`))
    .returning({ id: standingAuthorizations.id });
  return Boolean(row);
}

export async function createStandingAuthorization(input: {
  userId: string;
  organizationId: string | null;
  workflowId: string;
  toolId: string;
  connectionId: string;
  allowedDestinations: string[];
  maxExecutions?: number | null;
  maxExecutionsPerDay?: number | null;
  expiresAt: Date;
}): Promise<StandingAuthorization> {
  const tool = getAgentTool(input.toolId);
  if (!tool || tool.kind !== 'write') throw badRequest('Standing authorization requires a write tool.');
  if (!input.allowedDestinations.length) throw badRequest('At least one bound destination is required.');
  const [row] = await getDb()
    .insert(standingAuthorizations)
    .values({
      userId: input.userId,
      organizationId: input.organizationId,
      workflowId: input.workflowId,
      toolId: input.toolId,
      connectionId: input.connectionId,
      riskCeiling: tool.risk,
      allowedDestinations: input.allowedDestinations.map((s) => s.toLowerCase()),
      maxExecutions: input.maxExecutions ?? null,
      maxExecutionsPerDay: input.maxExecutionsPerDay ?? null,
      expiresAt: input.expiresAt,
      approvedByUserId: input.userId, // creation IS the explicit approval
      status: 'ACTIVE',
    })
    .returning();
  await logSecurityEvent({ event: 'workflow.standing_auth_created', userId: input.userId, actorUserId: input.userId, organizationId: input.organizationId, metadata: { toolId: input.toolId, workflowId: input.workflowId, destinations: input.allowedDestinations.length } });
  return row;
}

export async function revokeStandingAuthorization(userId: string, authId: string): Promise<void> {
  const [existing] = await getDb().select().from(standingAuthorizations).where(eq(standingAuthorizations.id, authId)).limit(1);
  if (!existing) throw notFound('Authorization not found');
  if (existing.userId !== userId) throw forbidden('You cannot revoke this authorization.');
  await getDb().update(standingAuthorizations).set({ status: 'REVOKED', revokedAt: new Date() }).where(eq(standingAuthorizations.id, authId));
  await logSecurityEvent({ event: 'workflow.standing_auth_revoked', userId, actorUserId: userId, organizationId: existing.organizationId, metadata: { authId } });
}

export async function listStandingAuthorizations(userId: string, workflowId?: string): Promise<StandingAuthorization[]> {
  const where = workflowId ? and(eq(standingAuthorizations.userId, userId), eq(standingAuthorizations.workflowId, workflowId)) : eq(standingAuthorizations.userId, userId);
  return getDb().select().from(standingAuthorizations).where(where);
}
