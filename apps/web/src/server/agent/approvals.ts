import { and, eq, gt, sql } from 'drizzle-orm';
import { getDb } from '@/server/db';
import { approvalRequests, agentActions } from '@/server/db/schema';
import type { ApprovalRequest } from '@/server/db/schema';
import { badRequest, forbidden, notFound } from '@/lib/errors';
import type { ActionPreview } from './preview';

/**
 * ApprovalService — human-in-the-loop authorization for side-effecting actions.
 *
 * Guarantees (all enforced in SQL, never trusted from the browser):
 *  - BOUND: an approval carries the exact normalized-arguments hash; if the action
 *    changes, the hash no longer matches and the approval is void.
 *  - SINGLE-USE: consuming flips APPROVED → CONSUMED atomically; replay finds no row.
 *  - EXPIRING: an approval past `expiresAt` cannot authorize anything.
 *  - OWNED: only the session's user may approve, and only that user may consume.
 */

function ttlMs(): number {
  const raw = Number(process.env.AGENT_APPROVAL_TTL_MS);
  return Number.isFinite(raw) && raw > 0 ? raw : 15 * 60_000; // 15 minutes
}

export async function createApproval(input: {
  actionId: string;
  agentSessionId: string;
  userId: string;
  organizationId: string | null;
  toolId: string;
  riskLevel: string;
  argumentsHash: string;
  preview: ActionPreview;
}): Promise<ApprovalRequest> {
  const expiresAt = new Date(Date.now() + ttlMs());
  const [row] = await getDb()
    .insert(approvalRequests)
    .values({
      actionId: input.actionId,
      agentSessionId: input.agentSessionId,
      userId: input.userId,
      organizationId: input.organizationId,
      toolId: input.toolId,
      riskLevel: input.riskLevel,
      argumentsHash: input.argumentsHash,
      preview: input.preview as unknown as Record<string, unknown>,
      status: 'PENDING',
      expiresAt,
    })
    .returning();
  await getDb().update(agentActions).set({ status: 'AWAITING_APPROVAL', approvalStatus: 'AWAITING_APPROVAL' }).where(eq(agentActions.id, input.actionId));
  return row;
}

/** Approve or reject. Only the owning user may decide; expired approvals cannot. */
export async function decideApproval(input: {
  approvalId: string;
  decidedByUserId: string;
  decision: 'APPROVED' | 'REJECTED';
  organizationId: string | null;
}): Promise<ApprovalRequest> {
  const db = getDb();
  const [existing] = await db.select().from(approvalRequests).where(eq(approvalRequests.id, input.approvalId)).limit(1);
  if (!existing) throw notFound('Approval not found');
  // Ownership: a different user (or a different org context) may not decide.
  if (existing.userId !== input.decidedByUserId) throw forbidden('You cannot decide this approval.');
  if ((existing.organizationId ?? null) !== (input.organizationId ?? null)) throw forbidden('Wrong workspace for this approval.');
  if (existing.status !== 'PENDING') throw badRequest('This approval was already decided.');
  if (existing.expiresAt.getTime() <= Date.now()) {
    await db.update(approvalRequests).set({ status: 'EXPIRED' }).where(eq(approvalRequests.id, existing.id));
    await db.update(agentActions).set({ status: 'EXPIRED', approvalStatus: 'EXPIRED' }).where(eq(agentActions.id, existing.actionId));
    throw badRequest('This approval has expired.');
  }

  const [updated] = await db
    .update(approvalRequests)
    .set({ status: input.decision, decidedByUserId: input.decidedByUserId, decidedAt: new Date() })
    .where(and(eq(approvalRequests.id, existing.id), eq(approvalRequests.status, 'PENDING')))
    .returning();
  if (!updated) throw badRequest('This approval was already decided.');

  await db
    .update(agentActions)
    .set({
      status: input.decision === 'APPROVED' ? 'APPROVED' : 'REJECTED',
      approvalStatus: input.decision,
      approvedAt: input.decision === 'APPROVED' ? new Date() : null,
    })
    .where(eq(agentActions.id, existing.actionId));
  return updated;
}

/**
 * Consume an approval at execution time. Atomic + single-use: succeeds only if the
 * approval is APPROVED, unexpired, hash-matched, and owned by the executing user.
 * Any mismatch (reuse, edit-after-approval, wrong user, expiry, forged id) → null.
 */
export async function consumeApproval(input: {
  actionId: string;
  argumentsHash: string;
  expectedUserId: string;
  organizationId: string | null;
}): Promise<ApprovalRequest | null> {
  const db = getDb();
  const conds = [
    eq(approvalRequests.actionId, input.actionId),
    eq(approvalRequests.status, 'APPROVED'),
    eq(approvalRequests.argumentsHash, input.argumentsHash),
    eq(approvalRequests.userId, input.expectedUserId),
    gt(approvalRequests.expiresAt, new Date()),
  ];
  if (input.organizationId) conds.push(eq(approvalRequests.organizationId, input.organizationId));
  else conds.push(sql`${approvalRequests.organizationId} is null`);

  const [row] = await db
    .update(approvalRequests)
    .set({ status: 'CONSUMED', consumedAt: new Date() })
    .where(and(...conds))
    .returning();
  return row ?? null;
}

/** Invalidate an approval (e.g. the user edited the action before executing). */
export async function expireApproval(approvalId: string): Promise<void> {
  await getDb().update(approvalRequests).set({ status: 'EXPIRED' }).where(and(eq(approvalRequests.id, approvalId), eq(approvalRequests.status, 'PENDING')));
}

export async function getApproval(approvalId: string): Promise<ApprovalRequest | null> {
  const [row] = await getDb().select().from(approvalRequests).where(eq(approvalRequests.id, approvalId)).limit(1);
  return row ?? null;
}
