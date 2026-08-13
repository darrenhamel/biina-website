import { eq } from 'drizzle-orm';
import { getDb } from '@/server/db';
import { organizationSecurityPolicies, deploymentProfiles } from '@/server/db/schema';
import type { OrganizationSecurityPolicy, DeploymentProfile } from '@/server/db/schema';
import { sovereignModeEnabled } from './config';

/**
 * OrganizationSecurityPolicy resolution — the enterprise generalization of the agent
 * policy resolver. Effective policy folds, most-restrictive-wins, in this order:
 *
 *   Platform defaults → Deployment profile → Organization policy
 *
 * Every layer can only TIGHTEN. Booleans AND together (false wins); enums pick the
 * more restrictive; allowlists NARROW (intersection of the non-empty ones — empty
 * means "no additional restriction"). Group/role and user preferences tighten further
 * downstream in each domain; nothing here can LOOSEN a platform or deployment rule.
 */

export type WebSearchMode = 'DISABLED' | 'PUBLIC_ONLY' | 'APPROVED_DOMAINS' | 'STANDARD';
export type MarketplaceMode = 'DISABLED' | 'ORGANIZATION_ONLY' | 'CURATED_ONLY' | 'PUBLIC_ALLOWED';

export interface EffectiveSecurityPolicy {
  externalAIAllowed: boolean;
  allowedAIProviders: string[]; // empty = all permitted
  allowedModelProfiles: string[];
  webSearchMode: WebSearchMode;
  approvedResearchDomains: string[];
  personalConnectorsAllowed: boolean;
  organizationConnectorsRequired: boolean;
  allowedConnectors: string[];
  agentsEnabled: boolean;
  externalWritesEnabled: boolean;
  standingAuthorizationsAllowed: boolean;
  maxAgentSteps: number | null;
  scheduledAutomationsEnabled: boolean;
  scheduledWritesEnabled: boolean;
  memoryEnabled: boolean;
  multimodalEnabled: boolean;
  researchEnabled: boolean;
  researchExternalWebAllowed: boolean;
  marketplaceMode: MarketplaceMode;
  dataExportAllowed: boolean;
  externalWebSearchAllowed: boolean;
  externalConnectorsAllowed: boolean;
}

const WEB_MODE_RANK: Record<WebSearchMode, number> = { DISABLED: 3, APPROVED_DOMAINS: 2, PUBLIC_ONLY: 1, STANDARD: 0 };
const MARKET_RANK: Record<MarketplaceMode, number> = { DISABLED: 3, ORGANIZATION_ONLY: 2, CURATED_ONLY: 1, PUBLIC_ALLOWED: 0 };

const and = (a: boolean, b: boolean) => a && b;
const moreRestrictiveWeb = (a: WebSearchMode, b: WebSearchMode) => (WEB_MODE_RANK[a] >= WEB_MODE_RANK[b] ? a : b);
const moreRestrictiveMarket = (a: MarketplaceMode, b: MarketplaceMode) => (MARKET_RANK[a] >= MARKET_RANK[b] ? a : b);
const minN = (a: number | null, b: number | null): number | null => (a == null ? b : b == null ? a : Math.min(a, b));
/** Narrow two allowlists (empty = "no restriction"). Result = intersection of non-empty. */
function narrow(a: string[], b: string[]): string[] {
  if (!a.length) return [...b];
  if (!b.length) return [...a];
  const bs = new Set(b);
  return a.filter((x) => bs.has(x));
}

/** The permissive platform baseline. Sovereign mode flips external access OFF. */
export function platformDefaults(): EffectiveSecurityPolicy {
  const sovereign = sovereignModeEnabled();
  return {
    externalAIAllowed: !sovereign,
    allowedAIProviders: [],
    allowedModelProfiles: [],
    webSearchMode: sovereign ? 'DISABLED' : 'STANDARD',
    approvedResearchDomains: [],
    personalConnectorsAllowed: !sovereign,
    organizationConnectorsRequired: false,
    allowedConnectors: [],
    agentsEnabled: true,
    externalWritesEnabled: !sovereign,
    standingAuthorizationsAllowed: true,
    maxAgentSteps: null,
    scheduledAutomationsEnabled: true,
    scheduledWritesEnabled: !sovereign,
    memoryEnabled: true,
    multimodalEnabled: true,
    researchEnabled: true,
    researchExternalWebAllowed: !sovereign,
    marketplaceMode: 'PUBLIC_ALLOWED',
    dataExportAllowed: true,
    externalWebSearchAllowed: !sovereign,
    externalConnectorsAllowed: !sovereign,
  };
}

function applyDeployment(base: EffectiveSecurityPolicy, dp: DeploymentProfile): EffectiveSecurityPolicy {
  return {
    ...base,
    externalAIAllowed: and(base.externalAIAllowed, dp.externalAIAllowed),
    externalWebSearchAllowed: and(base.externalWebSearchAllowed, dp.externalWebSearchAllowed),
    externalConnectorsAllowed: and(base.externalConnectorsAllowed, dp.externalConnectorsAllowed),
    // If the deployment forbids external web search, force the web mode down.
    webSearchMode: dp.externalWebSearchAllowed ? base.webSearchMode : moreRestrictiveWeb(base.webSearchMode, 'PUBLIC_ONLY'),
    personalConnectorsAllowed: dp.externalConnectorsAllowed ? base.personalConnectorsAllowed : false,
    allowedAIProviders: narrow(base.allowedAIProviders, dp.allowedModelProviders ?? []),
    researchExternalWebAllowed: and(base.researchExternalWebAllowed, dp.externalWebSearchAllowed),
    externalWritesEnabled: and(base.externalWritesEnabled, dp.externalConnectorsAllowed),
  };
}

function applyOrg(base: EffectiveSecurityPolicy, o: OrganizationSecurityPolicy): EffectiveSecurityPolicy {
  return {
    externalAIAllowed: and(base.externalAIAllowed, o.externalAIAllowed),
    allowedAIProviders: narrow(base.allowedAIProviders, o.allowedAIProviders ?? []),
    allowedModelProfiles: narrow(base.allowedModelProfiles, o.allowedModelProfiles ?? []),
    webSearchMode: moreRestrictiveWeb(base.webSearchMode, (o.webSearchMode as WebSearchMode) ?? 'STANDARD'),
    approvedResearchDomains: o.approvedResearchDomains ?? base.approvedResearchDomains,
    personalConnectorsAllowed: and(base.personalConnectorsAllowed, o.personalConnectorsAllowed),
    organizationConnectorsRequired: base.organizationConnectorsRequired || o.organizationConnectorsRequired,
    allowedConnectors: narrow(base.allowedConnectors, o.allowedConnectors ?? []),
    agentsEnabled: and(base.agentsEnabled, o.agentsEnabled),
    externalWritesEnabled: and(base.externalWritesEnabled, o.externalWritesEnabled),
    standingAuthorizationsAllowed: and(base.standingAuthorizationsAllowed, o.standingAuthorizationsAllowed),
    maxAgentSteps: minN(base.maxAgentSteps, o.maxAgentSteps),
    scheduledAutomationsEnabled: and(base.scheduledAutomationsEnabled, o.scheduledAutomationsEnabled),
    scheduledWritesEnabled: and(base.scheduledWritesEnabled, o.scheduledWritesEnabled),
    memoryEnabled: and(base.memoryEnabled, o.memoryEnabled),
    multimodalEnabled: and(base.multimodalEnabled, o.multimodalEnabled),
    researchEnabled: and(base.researchEnabled, o.researchEnabled),
    researchExternalWebAllowed: and(base.researchExternalWebAllowed, o.researchExternalWebAllowed),
    marketplaceMode: moreRestrictiveMarket(base.marketplaceMode, (o.marketplaceMode as MarketplaceMode) ?? 'PUBLIC_ALLOWED'),
    dataExportAllowed: and(base.dataExportAllowed, o.dataExportAllowed),
    externalWebSearchAllowed: base.externalWebSearchAllowed,
    externalConnectorsAllowed: base.externalConnectorsAllowed,
  };
}

/** Pure fold — used by tests without a DB. */
export function combineSecurityPolicy(deployment: DeploymentProfile | null, org: OrganizationSecurityPolicy | null): EffectiveSecurityPolicy {
  let p = platformDefaults();
  if (deployment) p = applyDeployment(p, deployment);
  if (org) p = applyOrg(p, org);
  return p;
}

/** Resolve the effective policy for an organization (personal context = platform defaults). */
export async function resolveSecurityPolicy(input: { organizationId: string | null; deploymentProfileId?: string | null }): Promise<EffectiveSecurityPolicy> {
  if (!input.organizationId) return platformDefaults();
  const db = getDb();
  const [org] = await db.select().from(organizationSecurityPolicies).where(eq(organizationSecurityPolicies.organizationId, input.organizationId)).limit(1);
  let deployment: DeploymentProfile | null = null;
  if (input.deploymentProfileId) {
    [deployment] = await db.select().from(deploymentProfiles).where(eq(deploymentProfiles.id, input.deploymentProfileId)).limit(1);
  }
  return combineSecurityPolicy(deployment ?? null, org ?? null);
}
