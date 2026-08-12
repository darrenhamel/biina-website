import { eq } from 'drizzle-orm';
import { GatewayError } from '@biina/ai-gateway';
import { getDb } from '@/server/db';
import { plans, planAssignments, users } from '@/server/db/schema';
import type { Plan } from '@/server/db/schema';
import { writeAudit } from './audit';

/**
 * Plan catalog — DB-backed entitlements with a short-lived cache. The effective
 * plan for a user is their `users.plan` slug (kept in sync on assignment). Plan
 * assignment history (with startsAt/endsAt) is recorded for trial/expiry
 * readiness; automatic expiry is a later phase.
 */

export const DEFAULT_PLAN_SLUG = 'FREE';

/** Safe fallback if the plans table is empty (keeps metering from hard-failing). */
const FALLBACK_FREE: Plan = {
  slug: 'FREE',
  displayName: 'Free',
  enabled: true,
  dailyRequestLimit: 50,
  monthlyRequestLimit: 500,
  dailyTokenLimit: 100_000,
  monthlyTokenLimit: 1_000_000,
  requestsPerMinute: 5,
  maxConcurrent: 1,
  maxContextTokens: 8_000,
  maxOutputTokens: 1_024,
  allowedModels: [],
  allowedWorkloads: [],
  allowedPersonas: [],
  filesEligible: false,
  toolsEligible: false,
  webSearchEligible: false,
  priorityClass: 100,
  updatedAt: new Date(0),
};

const TTL_MS = 5_000;
let cache: { at: number; map: Map<string, Plan> } | null = null;

export function invalidatePlans(): void {
  cache = null;
}

export async function loadPlans(force = false): Promise<Map<string, Plan>> {
  if (!force && cache && Date.now() - cache.at < TTL_MS) return cache.map;
  const rows = await getDb().select().from(plans);
  const map = new Map(rows.map((p) => [p.slug, p] as const));
  cache = { at: Date.now(), map };
  return map;
}

/** Resolve the effective plan for a slug, falling back safely. */
export async function getPlan(slug: string): Promise<Plan> {
  const map = await loadPlans();
  return map.get(slug) ?? map.get(DEFAULT_PLAN_SLUG) ?? FALLBACK_FREE;
}

export async function listPlans(): Promise<Plan[]> {
  const map = await loadPlans(true);
  return Array.from(map.values());
}

// ---- Admin operations (audited, cache-invalidating) ----

export async function updatePlan(slug: string, patch: Record<string, unknown>, adminUserId: string) {
  const db = getDb();
  const [prev] = await db.select().from(plans).where(eq(plans.slug, slug)).limit(1);
  if (!prev) throw new GatewayError('invalid_config', 'Plan not found');

  const set: Record<string, unknown> = { updatedAt: new Date() };
  for (const key of [
    'displayName',
    'enabled',
    'dailyRequestLimit',
    'monthlyRequestLimit',
    'dailyTokenLimit',
    'monthlyTokenLimit',
    'requestsPerMinute',
    'maxConcurrent',
    'maxContextTokens',
    'maxOutputTokens',
    'allowedModels',
    'allowedWorkloads',
    'allowedPersonas',
    'filesEligible',
    'toolsEligible',
    'webSearchEligible',
    'priorityClass',
  ] as const) {
    if (patch[key] !== undefined) set[key] = patch[key];
  }
  await db.update(plans).set(set).where(eq(plans.slug, slug));
  invalidatePlans();
  await writeAudit({
    adminUserId,
    action: 'plan.update',
    targetType: 'plan',
    targetId: slug,
    previousValue: pick(prev, Object.keys(set)),
    newValue: set,
  });
  return { ok: true };
}

export async function assignPlan(
  userId: string,
  planSlug: string,
  adminUserId: string,
  opts: { note?: string; endsAt?: string | null } = {},
) {
  const db = getDb();
  const map = await loadPlans(true);
  if (!map.has(planSlug)) throw new GatewayError('invalid_config', 'Unknown plan');

  const [prev] = await db.select({ plan: users.plan }).from(users).where(eq(users.id, userId)).limit(1);
  if (!prev) throw new GatewayError('invalid_config', 'User not found');

  await db.update(users).set({ plan: planSlug as Plan['slug'] as never, updatedAt: new Date() }).where(eq(users.id, userId));
  await db.insert(planAssignments).values({
    userId,
    planSlug,
    assignedBy: adminUserId,
    note: opts.note ?? null,
    endsAt: opts.endsAt ? new Date(opts.endsAt) : null,
  });
  await writeAudit({
    adminUserId,
    action: 'plan.assign',
    targetType: 'user',
    targetId: userId,
    previousValue: { plan: prev.plan },
    newValue: { plan: planSlug, endsAt: opts.endsAt ?? null },
  });
  return { ok: true };
}

function pick(row: Record<string, unknown>, keys: string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of keys) if (k !== 'updatedAt' && k in row) out[k] = row[k];
  return out;
}
