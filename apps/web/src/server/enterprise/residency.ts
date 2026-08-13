import { eq } from 'drizzle-orm';
import { getDb } from '@/server/db';
import { dataResidencyPolicies, deploymentProfiles } from '@/server/db/schema';
import type { DataResidencyPolicy, DeploymentProfile } from '@/server/db/schema';

/**
 * Data-residency resolution. Combines the deployment profile's region constraints
 * with an organization's data-residency policy. Regions only ever NARROW. A region
 * appearing here is configuration, not a compliance claim.
 */

export interface EffectiveResidency {
  /** Regions a model provider MUST be in (empty = no hard requirement). */
  requiredRegions: string[];
  /** Regions that are permitted (empty = all permitted). */
  allowedRegions: string[];
  storageRegion: string | null;
  vectorRegion: string | null;
  modelInferenceRegion: string | null;
  externalTransferAllowed: boolean;
}

function intersect(a: string[], b: string[]): string[] {
  if (!a.length) return [...b];
  if (!b.length) return [...a];
  const bs = new Set(b);
  return a.filter((x) => bs.has(x));
}

export function combineResidency(deployment: DeploymentProfile | null, policy: DataResidencyPolicy | null): EffectiveResidency {
  const allowedFromDeployment = deployment?.allowedProviderRegions ?? [];
  const base: EffectiveResidency = {
    requiredRegions: [],
    allowedRegions: allowedFromDeployment,
    storageRegion: null,
    vectorRegion: null,
    modelInferenceRegion: null,
    externalTransferAllowed: deployment ? deployment.externalAIAllowed : true,
  };
  if (!policy) return base;
  // A required inference region also constrains the allowed set.
  const required = policy.requiredRegions ?? [];
  const inferenceRequired = policy.modelInferenceRegion ? [policy.modelInferenceRegion] : [];
  return {
    requiredRegions: intersect(base.requiredRegions.length ? base.requiredRegions : required, inferenceRequired.length ? inferenceRequired : required),
    allowedRegions: intersect(base.allowedRegions, policy.allowedRegions ?? []),
    storageRegion: policy.storageRegion ?? base.storageRegion,
    vectorRegion: policy.vectorRegion ?? base.vectorRegion,
    modelInferenceRegion: policy.modelInferenceRegion ?? base.modelInferenceRegion,
    externalTransferAllowed: base.externalTransferAllowed && policy.externalTransferAllowed,
  };
}

export async function resolveResidency(input: { organizationId: string | null; deploymentProfileId?: string | null }): Promise<EffectiveResidency> {
  const db = getDb();
  let deployment: DeploymentProfile | null = null;
  if (input.deploymentProfileId) {
    [deployment] = await db.select().from(deploymentProfiles).where(eq(deploymentProfiles.id, input.deploymentProfileId)).limit(1);
  }
  let policy: DataResidencyPolicy | null = null;
  if (input.organizationId) {
    [policy] = await db.select().from(dataResidencyPolicies).where(eq(dataResidencyPolicies.organizationId, input.organizationId)).limit(1);
  }
  return combineResidency(deployment ?? null, policy ?? null);
}

/** Does a provider's region satisfy the residency requirement? */
export function regionSatisfies(region: string | null | undefined, res: EffectiveResidency): boolean {
  const r = region ?? null;
  if (res.requiredRegions.length) {
    if (!r || !res.requiredRegions.includes(r)) return false;
  }
  if (res.allowedRegions.length) {
    if (!r || !res.allowedRegions.includes(r)) return false;
  }
  return true;
}
