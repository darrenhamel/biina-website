import { eq } from 'drizzle-orm';
import { getDb } from '@/server/db';
import { deploymentProfiles, organizations } from '@/server/db/schema';
import type { DeploymentProfile } from '@/server/db/schema';
import { AppError } from '@/lib/errors';
import { logSecurityEvent } from '@/server/auth/events';
import { resolveSecurityPolicy, type EffectiveSecurityPolicy } from './security-policy';
import { resolveResidency, type EffectiveResidency } from './residency';

/**
 * Deployment profiles + the per-request governance resolver. A deployment profile is
 * PLATFORM-managed and encodes trusted infrastructure boundaries. A privileged profile
 * (sovereign / private-cloud / dedicated) can only be assigned to an organization by a
 * PLATFORM admin — never self-assigned by an org admin.
 */

export async function listDeploymentProfiles(): Promise<DeploymentProfile[]> {
  return getDb().select().from(deploymentProfiles);
}

export async function getDeploymentProfile(id: string | null | undefined): Promise<DeploymentProfile | null> {
  if (!id) return null;
  const [p] = await getDb().select().from(deploymentProfiles).where(eq(deploymentProfiles.id, id)).limit(1);
  return p ?? null;
}

/** Assign a deployment profile to an org. `platformAdmin` MUST be verified by caller;
 *  a privileged profile requires it (defense in depth — the route also guards). */
export async function assignDeploymentProfile(organizationId: string, profileId: string | null, opts: { platformAdmin: boolean; actorUserId: string }): Promise<void> {
  const db = getDb();
  if (profileId) {
    const profile = await getDeploymentProfile(profileId);
    if (!profile || !profile.enabled) throw new AppError(400, 'Unknown or disabled deployment profile.', 'bad_profile');
    if (profile.privileged && !opts.platformAdmin) {
      throw new AppError(403, 'A privileged deployment profile can only be assigned by a platform administrator.', 'privileged_profile');
    }
  }
  await db.update(organizations).set({ deploymentProfileId: profileId, updatedAt: new Date() }).where(eq(organizations.id, organizationId));
  await logSecurityEvent({ event: 'enterprise.deployment_assigned', actorUserId: opts.actorUserId, organizationId, metadata: { profileId } });
}

export interface OrgGovernance {
  organizationId: string | null;
  deploymentProfile: DeploymentProfile | null;
  policy: EffectiveSecurityPolicy;
  residency: EffectiveResidency;
}

/**
 * Resolve the full governance context for an organization (or personal context).
 * This is the single entry point routes/services use to obtain the effective security
 * policy + residency, already folded most-restrictive across platform → deployment →
 * organization.
 */
export async function resolveOrgGovernance(organizationId: string | null): Promise<OrgGovernance> {
  let deploymentProfile: DeploymentProfile | null = null;
  if (organizationId) {
    const [org] = await getDb().select({ dp: organizations.deploymentProfileId }).from(organizations).where(eq(organizations.id, organizationId)).limit(1);
    deploymentProfile = await getDeploymentProfile(org?.dp ?? null);
  }
  const [policy, residency] = await Promise.all([
    resolveSecurityPolicy({ organizationId, deploymentProfileId: deploymentProfile?.id ?? null }),
    resolveResidency({ organizationId, deploymentProfileId: deploymentProfile?.id ?? null }),
  ]);
  return { organizationId, deploymentProfile, policy, residency };
}

/** Build the enterprise portion of a RouteContext from resolved governance. */
export function routeConstraintsFor(gov: OrgGovernance): {
  residency: { requiredRegions: string[]; allowedRegions: string[] };
  externalAIAllowed: boolean;
  allowedProviderSlugs: string[];
  allowedModelSlugs: string[];
} {
  return {
    residency: { requiredRegions: gov.residency.requiredRegions, allowedRegions: gov.residency.allowedRegions },
    externalAIAllowed: gov.policy.externalAIAllowed,
    allowedProviderSlugs: gov.policy.allowedAIProviders,
    allowedModelSlugs: gov.policy.allowedModelProfiles,
  };
}
