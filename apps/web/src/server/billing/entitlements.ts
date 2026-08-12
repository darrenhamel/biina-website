import { and, desc, eq, gt, isNull, or } from 'drizzle-orm';
import { getDb } from '@/server/db';
import { planAssignments, users, organizations, subscriptions } from '@/server/db/schema';
import type { PlanSource, Subscription, SubscriptionStatus } from '@/server/db/schema';
import { writeAudit } from '@/server/ai/audit';

/**
 * Subscription → entitlement synchronization.
 *
 * ENTITLEMENTS FOLLOW VERIFIED BILLING STATE, never a browser claim. A confirmed
 * subscription drives a plan_assignment (source SUBSCRIPTION/TRIAL); the account's
 * effective plan is then RECOMPUTED from its assignments. The most-recently
 * created still-active assignment wins — so a later paid subscription upgrades a
 * stale manual grant, and a later manual grant still overrides a subscription.
 * `source` keeps PAID / MANUAL / TRIAL distinct for reporting, without changing
 * precedence.
 */

export const DEFAULT_PLAN_SLUG = 'FREE';

export function graceDays(): number {
  const n = Number(process.env.BILLING_GRACE_DAYS);
  return Number.isFinite(n) && n >= 0 ? n : 3;
}

export interface EntitlementDecision {
  planSlug: string;
  source: Extract<PlanSource, 'SUBSCRIPTION' | 'TRIAL' | 'ORGANIZATION'>;
  endsAt: Date | null;
}

/**
 * Pure: given a stored subscription, decide the entitlement it currently confers
 * (or null = no entitlement → account falls back to its next assignment / FREE).
 * Grace: PAST_DUE keeps access until currentPeriodEnd + grace.
 */
export function decideEntitlement(
  sub: Pick<Subscription, 'planSlug' | 'status' | 'currentPeriodEnd' | 'cancelAtPeriodEnd' | 'organizationId'>,
  now: Date,
  grace: number = graceDays(),
): EntitlementDecision | null {
  const source: EntitlementDecision['source'] = sub.organizationId
    ? 'ORGANIZATION'
    : sub.status === 'TRIALING'
      ? 'TRIAL'
      : 'SUBSCRIPTION';
  const grant = (endsAt: Date | null): EntitlementDecision => ({ planSlug: sub.planSlug, source, endsAt });

  const status: SubscriptionStatus = sub.status;
  const periodEnd = sub.currentPeriodEnd ?? null;

  switch (status) {
    case 'ACTIVE':
    case 'TRIALING':
      // Access through the current period (renewal extends it on the next event).
      return grant(periodEnd);
    case 'PAST_DUE': {
      // Grace window past the period end before access is pulled.
      if (!periodEnd) return grant(null);
      const graceEnd = new Date(periodEnd.getTime() + grace * 86_400_000);
      return now < graceEnd ? grant(graceEnd) : null;
    }
    case 'CANCELED':
      // Canceled but still paid through the period keeps access until it ends.
      return periodEnd && periodEnd > now ? grant(periodEnd) : null;
    case 'INCOMPLETE':
    case 'UNPAID':
    case 'PAUSED':
    default:
      return null;
  }
}

/** Active (not-yet-ended) assignments for a scope, newest first. */
async function activeAssignments(where: ReturnType<typeof eq>, now: Date) {
  return getDb()
    .select()
    .from(planAssignments)
    .where(and(where, or(isNull(planAssignments.endsAt), gt(planAssignments.endsAt, now))))
    .orderBy(desc(planAssignments.createdAt));
}

/**
 * Recompute an account's effective plan from its active assignments and persist
 * it (users.plan for a user, organizations.planSlug for an org). Idempotent.
 */
export async function recomputeEffectivePlan(
  scope: { userId: string } | { organizationId: string },
  now: Date = new Date(),
): Promise<string> {
  const db = getDb();
  const rows =
    'userId' in scope
      ? await activeAssignments(eq(planAssignments.userId, scope.userId), now)
      : await activeAssignments(eq(planAssignments.organizationId, scope.organizationId), now);

  const effective = rows[0]?.planSlug ?? DEFAULT_PLAN_SLUG;

  if ('userId' in scope) {
    await db.update(users).set({ plan: effective as never, updatedAt: new Date() }).where(eq(users.id, scope.userId));
  } else {
    await db.update(organizations).set({ planSlug: effective, updatedAt: new Date() }).where(eq(organizations.id, scope.organizationId));
  }
  return effective;
}

/**
 * Apply a stored subscription's entitlement: update-in-place the subscription's
 * plan_assignment (or expire it on revoke), then recompute the effective plan.
 * Idempotent — replaying the same provider state is a no-op.
 */
export async function syncEntitlementForSubscription(sub: Subscription, now: Date = new Date()): Promise<string> {
  const db = getDb();
  const decision = decideEntitlement(sub, now);

  const scopeCol = sub.organizationId ? planAssignments.organizationId : planAssignments.userId;
  const scopeId = sub.organizationId ?? sub.userId!;
  const [existing] = await db
    .select()
    .from(planAssignments)
    .where(and(eq(planAssignments.subscriptionId, sub.id), eq(scopeCol, scopeId)))
    .limit(1);

  if (!decision) {
    // Revoke: end the subscription's assignment if still active.
    if (existing && (!existing.endsAt || existing.endsAt > now)) {
      await db.update(planAssignments).set({ endsAt: now }).where(eq(planAssignments.id, existing.id));
    }
  } else if (existing) {
    // Update in place (keeps recency stable across renewals) — idempotent.
    const changed =
      existing.planSlug !== decision.planSlug ||
      existing.source !== decision.source ||
      (existing.endsAt?.getTime() ?? null) !== (decision.endsAt?.getTime() ?? null);
    if (changed) {
      await db
        .update(planAssignments)
        .set({ planSlug: decision.planSlug, source: decision.source, endsAt: decision.endsAt })
        .where(eq(planAssignments.id, existing.id));
    }
  } else {
    await db.insert(planAssignments).values({
      userId: sub.userId ?? null,
      organizationId: sub.organizationId ?? null,
      planSlug: decision.planSlug,
      source: decision.source,
      subscriptionId: sub.id,
      endsAt: decision.endsAt,
      note: `subscription ${sub.providerSubscriptionId}`,
    } as never);
  }

  const scope = sub.organizationId ? { organizationId: sub.organizationId } : { userId: sub.userId! };
  const effective = await recomputeEffectivePlan(scope, now);
  await writeAudit({
    action: 'billing.entitlement.sync',
    targetType: sub.organizationId ? 'organization' : 'user',
    targetId: scopeId,
    newValue: { subscriptionStatus: sub.status, granted: decision?.planSlug ?? null, effective },
  });
  return effective;
}

/** List an account's plan-assignment history (source-tagged) for admin/debug. */
export async function assignmentHistory(scope: { userId: string } | { organizationId: string }, limit = 20) {
  const where = 'userId' in scope ? eq(planAssignments.userId, scope.userId) : eq(planAssignments.organizationId, scope.organizationId);
  return getDb().select().from(planAssignments).where(where).orderBy(desc(planAssignments.createdAt)).limit(limit);
}

/** Reference to the subscriptions table for callers that need the type. */
export { subscriptions };
