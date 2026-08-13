import { eq } from 'drizzle-orm';
import { getDb } from '@/server/db';
import { retentionPolicies, deploymentProfiles } from '@/server/db/schema';
import type { RetentionPolicy } from '@/server/db/schema';
import { logSecurityEvent } from '@/server/auth/events';

/**
 * Retention policy resolution. Effective retention folds:
 *   Platform minimum → Deployment policy → Organization policy
 * An organization may become STRICTER (shorter) where allowed, but never shorter than
 * a platform-required operational minimum. Records under a legal hold are exempt from
 * deletion (readiness — hold enforcement is a later phase). This module resolves policy
 * + exposes a dry-run pruning planner; destructive pruning is gated and staged.
 */

/** Platform operational minimums (days). Retention cannot go below these. */
export const PLATFORM_MIN_RETENTION_DAYS = {
  conversation: 1,
  file: 1,
  audit: 30, // security audit must survive short org windows
  memory: 1,
  research: 1,
  workflowRun: 1,
};

export interface EffectiveRetention {
  conversationRetentionDays: number | null;
  fileRetentionDays: number | null;
  auditRetentionDays: number | null;
  memoryRetentionDays: number | null;
  researchRetentionDays: number | null;
  workflowRunRetentionDays: number | null;
  deletionMode: string;
  legalHoldEnabled: boolean;
}

function clampToMin(value: number | null, min: number): number | null {
  if (value == null) return null; // null = keep indefinitely
  return Math.max(value, min);
}

export function combineRetention(deployment: RetentionPolicy | null, org: RetentionPolicy | null): EffectiveRetention {
  const pick = (get: (p: RetentionPolicy) => number | null): number | null => {
    const vals = [deployment, org].filter(Boolean).map((p) => get(p!)).filter((v): v is number => v != null);
    return vals.length ? Math.min(...vals) : null;
  };
  return {
    conversationRetentionDays: clampToMin(pick((p) => p.conversationRetentionDays), PLATFORM_MIN_RETENTION_DAYS.conversation),
    fileRetentionDays: clampToMin(pick((p) => p.fileRetentionDays), PLATFORM_MIN_RETENTION_DAYS.file),
    auditRetentionDays: clampToMin(pick((p) => p.auditRetentionDays), PLATFORM_MIN_RETENTION_DAYS.audit),
    memoryRetentionDays: clampToMin(pick((p) => p.memoryRetentionDays), PLATFORM_MIN_RETENTION_DAYS.memory),
    researchRetentionDays: clampToMin(pick((p) => p.researchRetentionDays), PLATFORM_MIN_RETENTION_DAYS.research),
    workflowRunRetentionDays: clampToMin(pick((p) => p.workflowRunRetentionDays), PLATFORM_MIN_RETENTION_DAYS.workflowRun),
    deletionMode: org?.deletionMode ?? deployment?.deletionMode ?? 'SOFT_DELETE',
    legalHoldEnabled: Boolean(org?.legalHoldEnabled || deployment?.legalHoldEnabled),
  };
}

export async function resolveRetention(input: { organizationId: string | null; deploymentProfileId?: string | null }): Promise<EffectiveRetention> {
  const db = getDb();
  let deployment: RetentionPolicy | null = null;
  if (input.deploymentProfileId) {
    const [dp] = await db.select().from(deploymentProfiles).where(eq(deploymentProfiles.id, input.deploymentProfileId)).limit(1);
    if (dp?.retentionPolicyId) [deployment] = await db.select().from(retentionPolicies).where(eq(retentionPolicies.id, dp.retentionPolicyId)).limit(1);
  }
  let org: RetentionPolicy | null = null;
  if (input.organizationId) [org] = await db.select().from(retentionPolicies).where(eq(retentionPolicies.organizationId, input.organizationId)).limit(1);
  return combineRetention(deployment ?? null, org ?? null);
}

export async function upsertRetention(organizationId: string, patch: Partial<RetentionPolicy>, actorUserId: string): Promise<RetentionPolicy> {
  const db = getDb();
  const [existing] = await db.select().from(retentionPolicies).where(eq(retentionPolicies.organizationId, organizationId)).limit(1);
  let row: RetentionPolicy;
  if (existing) [row] = await db.update(retentionPolicies).set({ ...patch, updatedAt: new Date() }).where(eq(retentionPolicies.id, existing.id)).returning();
  else [row] = await db.insert(retentionPolicies).values({ organizationId, name: patch.name ?? 'Organization retention', ...patch }).returning();
  await logSecurityEvent({ event: 'enterprise.retention_changed', actorUserId, organizationId, metadata: { changed: Object.keys(patch) } });
  return row;
}
