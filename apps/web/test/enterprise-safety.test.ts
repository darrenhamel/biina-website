import { describe, it, expect } from 'vitest';
import { combineSecurityPolicy, platformDefaults } from '@/server/enterprise/security-policy';
import { combineResidency, regionSatisfies } from '@/server/enterprise/residency';
import { combineRetention, PLATFORM_MIN_RETENTION_DAYS } from '@/server/enterprise/retention';
import { BUILTIN_ROLES, baseRolePermissions, hasPermission, sanitizePermissions, isValidPermission } from '@/server/enterprise/rbac';
import { satisfiesEnterprisePolicy, type RouteContext } from '@/server/ai/routing';
import type { AiModel, AiProvider, DeploymentProfile, OrganizationSecurityPolicy, DataResidencyPolicy, RetentionPolicy } from '@/server/db/schema';

const provider = (over: Partial<AiProvider>): AiProvider => ({ id: 'p1', slug: 'prov', displayName: 'P', type: 'openai-compatible', enabled: true, region: 'US', ownerType: 'PLATFORM', ownerOrganizationId: null, isExternal: true, privateEndpoint: false, ...over } as unknown as AiProvider);
const model = (over: Partial<AiModel> = {}): AiModel => ({ id: 'm1', slug: 'biina', providerId: 'p1', enabled: true, ...over } as unknown as AiModel);
const dp = (over: Partial<DeploymentProfile>): DeploymentProfile => ({ externalAIAllowed: true, externalWebSearchAllowed: true, externalConnectorsAllowed: true, allowedModelProviders: [], allowedProviderRegions: [], ...over } as unknown as DeploymentProfile);
const orgPol = (over: Partial<OrganizationSecurityPolicy>): OrganizationSecurityPolicy => ({
  externalAIAllowed: true, allowedAIProviders: [], allowedModelProfiles: [], webSearchMode: 'STANDARD', approvedResearchDomains: [], personalConnectorsAllowed: true, organizationConnectorsRequired: false, allowedConnectors: [], agentsEnabled: true, externalWritesEnabled: true, standingAuthorizationsAllowed: true, maxAgentSteps: null, scheduledAutomationsEnabled: true, scheduledWritesEnabled: true, memoryEnabled: true, multimodalEnabled: true, researchEnabled: true, researchExternalWebAllowed: true, marketplaceMode: 'PUBLIC_ALLOWED', dataExportAllowed: true,
  ...over,
} as unknown as OrganizationSecurityPolicy);

describe('organization security policy precedence (most-restrictive wins)', () => {
  it('an org can tighten but never loosen platform defaults', () => {
    const eff = combineSecurityPolicy(null, orgPol({ externalWritesEnabled: false, marketplaceMode: 'DISABLED', personalConnectorsAllowed: false }));
    expect(eff.externalWritesEnabled).toBe(false);
    expect(eff.marketplaceMode).toBe('DISABLED');
    expect(eff.personalConnectorsAllowed).toBe(false);
  });
  it('a deployment profile forbidding external AI wins even if the org allows it', () => {
    const eff = combineSecurityPolicy(dp({ externalAIAllowed: false }), orgPol({ externalAIAllowed: true }));
    expect(eff.externalAIAllowed).toBe(false);
  });
  it('allowlists NARROW (intersection of non-empty)', () => {
    const eff = combineSecurityPolicy(dp({ allowedModelProviders: ['uae-prov', 'other-prov'] }), orgPol({ allowedAIProviders: ['uae-prov'] }));
    expect(eff.allowedAIProviders).toEqual(['uae-prov']);
  });
  it('web-search mode only ever gets more restrictive', () => {
    const eff = combineSecurityPolicy(null, orgPol({ webSearchMode: 'DISABLED' }));
    expect(eff.webSearchMode).toBe('DISABLED');
  });
});

describe('data-residency routing — no external fallback', () => {
  const uaeReq: RouteContext = { residency: { requiredRegions: ['UAE'], allowedRegions: ['UAE'] }, externalAIAllowed: false, organizationId: 'orgA' };
  it('a UAE-approved private provider satisfies UAE residency', () => {
    expect(satisfiesEnterprisePolicy(model(), provider({ region: 'UAE', isExternal: false, ownerType: 'ORGANIZATION', ownerOrganizationId: 'orgA' }), uaeReq)).toBe(true);
  });
  it('a non-UAE external provider is rejected under UAE residency', () => {
    expect(satisfiesEnterprisePolicy(model(), provider({ region: 'US', isExternal: true }), uaeReq)).toBe(false);
  });
  it('external providers are blocked when externalAIAllowed is false', () => {
    expect(satisfiesEnterprisePolicy(model(), provider({ region: 'UAE', isExternal: true }), { externalAIAllowed: false })).toBe(false);
  });
  it('a private ORGANIZATION provider is not selectable by another tenant', () => {
    const orgBReq: RouteContext = { organizationId: 'orgB' };
    expect(satisfiesEnterprisePolicy(model(), provider({ ownerType: 'ORGANIZATION', ownerOrganizationId: 'orgA' }), orgBReq)).toBe(false);
    expect(satisfiesEnterprisePolicy(model(), provider({ ownerType: 'ORGANIZATION', ownerOrganizationId: 'orgA' }), { organizationId: 'orgA' })).toBe(true);
  });
  it('regionSatisfies enforces required + allowed', () => {
    expect(regionSatisfies('UAE', combineResidency(null, { requiredRegions: ['UAE'], allowedRegions: [] } as unknown as DataResidencyPolicy))).toBe(true);
    expect(regionSatisfies('US', combineResidency(null, { requiredRegions: ['UAE'], allowedRegions: [] } as unknown as DataResidencyPolicy))).toBe(false);
  });
});

describe('enterprise RBAC — least privilege + separation of duties', () => {
  it('auditor cannot manage AI models', () => {
    expect(hasPermission(BUILTIN_ROLES.auditor.permissions, 'ai_models.manage')).toBe(false);
    expect(hasPermission(BUILTIN_ROLES.auditor.permissions, 'audit.read')).toBe(true);
  });
  it('security admin manages security but not billing/private knowledge', () => {
    expect(hasPermission(BUILTIN_ROLES['security-admin'].permissions, 'security.manage')).toBe(true);
    expect(hasPermission(BUILTIN_ROLES['security-admin'].permissions, 'billing.manage')).toBe(false);
    expect(hasPermission(BUILTIN_ROLES['security-admin'].permissions, 'knowledge.manage')).toBe(false);
  });
  it('billing admin cannot read the audit log or manage security', () => {
    expect(hasPermission(BUILTIN_ROLES['billing-admin'].permissions, 'audit.read')).toBe(false);
    expect(hasPermission(BUILTIN_ROLES['billing-admin'].permissions, 'security.manage')).toBe(false);
  });
  it('a plain member has no management permissions', () => {
    expect(baseRolePermissions('MEMBER')).toEqual([]);
    expect(hasPermission(baseRolePermissions('MEMBER'), 'members.manage')).toBe(false);
  });
  it('owner has everything; manage implies read', () => {
    expect(hasPermission(baseRolePermissions('OWNER'), 'security.manage')).toBe(true);
    expect(hasPermission(['ai_models.manage'], 'ai_models.read')).toBe(true);
  });
  it('arbitrary permission strings are rejected', () => {
    expect(isValidPermission('security.manage')).toBe(true);
    expect(isValidPermission('hack.everything')).toBe(false);
    expect(sanitizePermissions(['security.manage', 'hack.everything', '*'])).toEqual(['security.manage', '*']);
  });
});

describe('retention precedence + platform minimums', () => {
  it('org may shorten but never below the platform audit minimum', () => {
    const eff = combineRetention(null, { auditRetentionDays: 1, conversationRetentionDays: 7 } as unknown as RetentionPolicy);
    expect(eff.auditRetentionDays).toBe(PLATFORM_MIN_RETENTION_DAYS.audit); // clamped up to 30
    expect(eff.conversationRetentionDays).toBe(7);
  });
  it('null retention means keep indefinitely', () => {
    const eff = combineRetention(null, null);
    expect(eff.conversationRetentionDays).toBeNull();
  });
});

describe('sovereign mode default posture', () => {
  it('platform defaults are permissive when sovereign mode is off', () => {
    const p = platformDefaults();
    expect(p.externalAIAllowed).toBe(true);
    expect(p.marketplaceMode).toBe('PUBLIC_ALLOWED');
  });
});
