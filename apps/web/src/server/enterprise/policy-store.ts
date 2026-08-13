import { eq } from 'drizzle-orm';
import { getDb } from '@/server/db';
import { organizationSecurityPolicies, organizationConfigSnapshots } from '@/server/db/schema';
import type { OrganizationSecurityPolicy } from '@/server/db/schema';
import { logSecurityEvent } from '@/server/auth/events';

/**
 * Storage for the per-organization security policy row (the raw configuration, before
 * platform/deployment folding). Every change is versioned + snapshotted + audited for
 * change management and compliance evidence.
 */

/** Fields an org admin may configure. Server validates enums/arrays before storing. */
export type SecurityPolicyPatch = Partial<
  Pick<
    OrganizationSecurityPolicy,
    | 'allowedAIProviders'
    | 'allowedModelProfiles'
    | 'externalAIAllowed'
    | 'webSearchMode'
    | 'approvedResearchDomains'
    | 'personalConnectorsAllowed'
    | 'organizationConnectorsRequired'
    | 'allowedConnectors'
    | 'agentsEnabled'
    | 'externalWritesEnabled'
    | 'standingAuthorizationsAllowed'
    | 'maxAgentSteps'
    | 'scheduledAutomationsEnabled'
    | 'scheduledWritesEnabled'
    | 'memoryEnabled'
    | 'multimodalEnabled'
    | 'researchEnabled'
    | 'researchExternalWebAllowed'
    | 'researchMaxDepth'
    | 'marketplaceMode'
    | 'dataExportAllowed'
    | 'defaultDataClassification'
    | 'sessionMaxMinutes'
    | 'idleTimeoutMinutes'
    | 'ssoReauthMinutes'
    | 'ipAllowlist'
    | 'mfaRequired'
  >
>;

/** Especially sensitive changes may warrant a secondary confirmation (route-level). */
export const HIGH_RISK_POLICY_FIELDS: Array<keyof SecurityPolicyPatch> = ['externalAIAllowed', 'externalWritesEnabled'];

export async function getSecurityPolicyRow(organizationId: string): Promise<OrganizationSecurityPolicy> {
  const db = getDb();
  const [row] = await db.select().from(organizationSecurityPolicies).where(eq(organizationSecurityPolicies.organizationId, organizationId)).limit(1);
  if (row) return row;
  const [created] = await db.insert(organizationSecurityPolicies).values({ organizationId }).returning();
  return created;
}

export async function updateSecurityPolicy(organizationId: string, patch: SecurityPolicyPatch, actorUserId: string): Promise<OrganizationSecurityPolicy> {
  const db = getDb();
  const prev = await getSecurityPolicyRow(organizationId);
  const [row] = await db
    .update(organizationSecurityPolicies)
    .set({ ...patch, version: prev.version + 1, updatedByUserId: actorUserId, updatedAt: new Date() })
    .where(eq(organizationSecurityPolicies.organizationId, organizationId))
    .returning();
  // Snapshot for change management + audit evidence (no secrets in this row).
  await db.insert(organizationConfigSnapshots).values({ organizationId, kind: 'security_policy', snapshot: row as unknown as Record<string, unknown>, version: row.version, createdByUserId: actorUserId });
  const changedHighRisk = HIGH_RISK_POLICY_FIELDS.filter((f) => f in patch);
  await logSecurityEvent({ event: 'enterprise.security_policy_changed', actorUserId, organizationId, metadata: { changed: Object.keys(patch), highRisk: changedHighRisk } });
  return row;
}

export async function listConfigSnapshots(organizationId: string, kind?: string) {
  const rows = await getDb().select().from(organizationConfigSnapshots).where(eq(organizationConfigSnapshots.organizationId, organizationId));
  const filtered = kind ? rows.filter((r) => r.kind === kind) : rows;
  return filtered.sort((a, b) => b.version - a.version);
}
