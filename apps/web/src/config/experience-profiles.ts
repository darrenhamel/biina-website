/**
 * Experience Profiles — Phase 16.
 *
 * An Experience Profile is the SERVER-MANAGED richer layer over a persona
 * (`src/config/personas.ts`). It changes presentation, defaults, available
 * capabilities, recommended tools/templates, model-routing preference, and the
 * discovery experience — it does NOT create a new security boundary.
 *
 *   User → Experience Profile → ContextEngine → Entitlements + Policy →
 *   Model Routing → BIINA capabilities
 *
 * A persona NEVER grants capability by itself: entitlements (plan), organization
 * policy, and platform safety remain authoritative. Selecting "Government" does
 * not grant government data or private models; it only changes defaults + style.
 *
 * Persona rules live HERE (data), never scattered through React components. The
 * active profile is stored on `profiles.personaId` (a user's default experience).
 */

import { getPersona, type PersonaId, type PersonaConfig } from './personas';
import type { NavKey } from './navigation';

/** Product capabilities a profile may surface. Distinct from model capabilities. */
export type ProductCapability =
  | 'chat'
  | 'knowledge'
  | 'files'
  | 'web'
  | 'research'
  | 'agents'
  | 'automations'
  | 'connectors'
  | 'vision'
  | 'voice'
  | 'memory'
  | 'library'
  | 'publicLibrary';

export type AudienceType = 'GENERAL' | 'YOUTH' | 'STUDENT' | 'PROFESSIONAL' | 'ENTERPRISE' | 'GOVERNMENT';
export type MemoryPolicyProfile = 'CONSERVATIVE' | 'STANDARD' | 'ORG';
export type WebPolicyProfile = 'STRICT_SAFE' | 'SAFE' | 'STANDARD';
export type ConnectorPolicyProfile = 'DISABLED' | 'PERSONAL' | 'ORG_POLICY';
export type AgentPolicyProfile = 'DISABLED' | 'LIMITED' | 'STANDARD' | 'ORG_POLICY';
export type MarketplaceProfile = 'CURATED_KIDS' | 'CURATED_TEENS' | 'STANDARD' | 'CURATED_ONLY';

/** A home-screen suggestion. Labels are i18n keys resolved in the UI, never English here. */
export interface HomeAction {
  /** dictionary key under `experience.home.*` */
  labelKey: string;
  /** app sub-path (under /{locale}/app) or a library category slug when kind='library'. */
  target: string;
  kind: 'route' | 'library' | 'template';
}

export interface ExperienceProfile {
  id: PersonaId;
  slug: string;
  audienceType: AudienceType;
  /** Directly selectable by end users during onboarding. */
  enabled: boolean;
  /** Youth experiences require guardian/age handling — not directly self-selectable. */
  supervisedOnly: boolean;
  defaultForNewUsers: boolean;
  /** Logical PRODUCT model identity (never a vendor/model name). Resolved by routing. */
  defaultModelProfile: string;
  /** Key into the server-managed persona system-prompt profiles (system-prompt.ts). */
  systemProfileKey: PersonaId;
  /** Capabilities this persona MAY expose (still gated by plan + policy + safety). */
  allowedCapabilities: ProductCapability[];
  /** Capabilities surfaced first in the UI. */
  recommendedCapabilities: ProductCapability[];
  /** Ordered primary navigation for this persona (subset of NavKey, still entitlement-gated). */
  navigation: NavKey[];
  /** Home-screen starter actions. */
  home: HomeAction[];
  memoryPolicy: MemoryPolicyProfile;
  webPolicy: WebPolicyProfile;
  connectorPolicy: ConnectorPolicyProfile;
  agentPolicy: AgentPolicyProfile;
  marketplace: MarketplaceProfile;
  /** Library category slugs recommended for this persona. */
  recommendedCategories: string[];
  ageBand?: string;
  accent: string | null;
  label: { en: string; ar: string };
}

function base(id: PersonaId): Pick<ExperienceProfile, 'id' | 'systemProfileKey' | 'accent' | 'ageBand' | 'label'> {
  const p: PersonaConfig = getPersona(id);
  return { id, systemProfileKey: id, accent: p.accent, ageBand: p.ageBand, label: p.label };
}

/**
 * The profiles. Kept minimal + declarative. Everything a persona changes is data
 * here; safety/entitlements still apply on top of every capability.
 */
export const EXPERIENCE_PROFILES: Record<PersonaId, ExperienceProfile> = {
  default: {
    ...base('default'),
    slug: 'default',
    audienceType: 'GENERAL',
    enabled: true,
    supervisedOnly: false,
    defaultForNewUsers: true,
    defaultModelProfile: 'biina',
    allowedCapabilities: ['chat', 'knowledge', 'files', 'web', 'research', 'agents', 'automations', 'connectors', 'vision', 'voice', 'memory', 'library', 'publicLibrary'],
    recommendedCapabilities: ['chat', 'knowledge', 'research'],
    navigation: ['chat', 'knowledge', 'discover', 'research', 'agents', 'automations'],
    home: [
      { labelKey: 'write', target: 'chat', kind: 'route' },
      { labelKey: 'research', target: 'research', kind: 'route' },
      { labelKey: 'discover', target: 'discover', kind: 'route' },
    ],
    memoryPolicy: 'STANDARD',
    webPolicy: 'STANDARD',
    connectorPolicy: 'PERSONAL',
    agentPolicy: 'STANDARD',
    marketplace: 'STANDARD',
    recommendedCategories: ['writing', 'research', 'productivity'],
  },
  kids: {
    ...base('kids'),
    slug: 'kids',
    audienceType: 'YOUTH',
    enabled: false,
    supervisedOnly: true,
    defaultForNewUsers: false,
    defaultModelProfile: 'biina-learn',
    // Deliberately minimal: learning + creativity, no external actions/connectors/agents.
    allowedCapabilities: ['chat', 'knowledge', 'library'],
    recommendedCapabilities: ['chat', 'library'],
    navigation: ['chat', 'discover'],
    home: [
      { labelKey: 'askBiina', target: 'chat', kind: 'route' },
      { labelKey: 'learn', target: 'learn', kind: 'library' },
      { labelKey: 'create', target: 'create', kind: 'library' },
      { labelKey: 'explore', target: 'explore', kind: 'library' },
    ],
    memoryPolicy: 'CONSERVATIVE',
    webPolicy: 'STRICT_SAFE',
    connectorPolicy: 'DISABLED',
    agentPolicy: 'DISABLED',
    marketplace: 'CURATED_KIDS',
    recommendedCategories: ['learn', 'read', 'create', 'explore', 'languages', 'math', 'science', 'stories'],
  },
  teens: {
    ...base('teens'),
    slug: 'teens',
    audienceType: 'YOUTH',
    enabled: false,
    supervisedOnly: true,
    defaultForNewUsers: false,
    defaultModelProfile: 'biina-learn',
    allowedCapabilities: ['chat', 'knowledge', 'files', 'web', 'research', 'library'],
    recommendedCapabilities: ['chat', 'research', 'knowledge'],
    navigation: ['chat', 'knowledge', 'research', 'discover'],
    home: [
      { labelKey: 'study', target: 'chat', kind: 'route' },
      { labelKey: 'research', target: 'research', kind: 'route' },
      { labelKey: 'writing', target: 'writing', kind: 'library' },
    ],
    memoryPolicy: 'CONSERVATIVE',
    webPolicy: 'SAFE',
    connectorPolicy: 'DISABLED',
    agentPolicy: 'LIMITED',
    marketplace: 'CURATED_TEENS',
    recommendedCategories: ['study', 'research', 'writing', 'languages', 'career', 'creativity'],
  },
  campus: {
    ...base('campus'),
    slug: 'campus',
    audienceType: 'STUDENT',
    enabled: true,
    supervisedOnly: false,
    defaultForNewUsers: false,
    defaultModelProfile: 'biina-study',
    allowedCapabilities: ['chat', 'knowledge', 'files', 'web', 'research', 'vision', 'voice', 'memory', 'library'],
    recommendedCapabilities: ['research', 'knowledge', 'chat'],
    navigation: ['chat', 'knowledge', 'research', 'discover', 'files'],
    home: [
      { labelKey: 'summarizeNotes', target: 'chat', kind: 'route' },
      { labelKey: 'explainConcept', target: 'explain-a-concept', kind: 'template' },
      { labelKey: 'examPrep', target: 'practice-questions', kind: 'template' },
      { labelKey: 'researchTopic', target: 'research', kind: 'route' },
    ],
    memoryPolicy: 'STANDARD',
    webPolicy: 'SAFE',
    connectorPolicy: 'PERSONAL',
    agentPolicy: 'LIMITED',
    marketplace: 'STANDARD',
    recommendedCategories: ['study', 'research', 'writing', 'exam-prep', 'notes', 'presentations', 'career'],
  },
  professional: {
    ...base('professional'),
    slug: 'professional',
    audienceType: 'PROFESSIONAL',
    enabled: true,
    supervisedOnly: false,
    defaultForNewUsers: false,
    defaultModelProfile: 'biina',
    allowedCapabilities: ['chat', 'knowledge', 'files', 'web', 'research', 'agents', 'automations', 'connectors', 'vision', 'voice', 'memory', 'library', 'publicLibrary'],
    recommendedCapabilities: ['chat', 'research', 'automations'],
    navigation: ['chat', 'knowledge', 'research', 'agents', 'automations', 'discover'],
    home: [
      { labelKey: 'write', target: 'chat', kind: 'route' },
      { labelKey: 'research', target: 'research', kind: 'route' },
      { labelKey: 'analyze', target: 'chat', kind: 'route' },
      { labelKey: 'automate', target: 'automations', kind: 'route' },
    ],
    memoryPolicy: 'STANDARD',
    webPolicy: 'STANDARD',
    connectorPolicy: 'PERSONAL',
    agentPolicy: 'STANDARD',
    marketplace: 'STANDARD',
    recommendedCategories: ['writing', 'research', 'planning', 'productivity', 'career', 'automation'],
  },
  business: {
    ...base('business'),
    slug: 'business',
    audienceType: 'ENTERPRISE',
    enabled: true,
    supervisedOnly: false,
    defaultForNewUsers: false,
    defaultModelProfile: 'biina-business',
    allowedCapabilities: ['chat', 'knowledge', 'files', 'web', 'research', 'agents', 'automations', 'connectors', 'vision', 'voice', 'memory', 'library', 'publicLibrary'],
    recommendedCapabilities: ['knowledge', 'agents', 'automations'],
    navigation: ['chat', 'knowledge', 'research', 'agents', 'automations', 'discover'],
    home: [
      { labelKey: 'orgKnowledge', target: 'knowledge', kind: 'route' },
      { labelKey: 'research', target: 'research', kind: 'route' },
      { labelKey: 'agents', target: 'agents', kind: 'route' },
      { labelKey: 'automate', target: 'automations', kind: 'route' },
    ],
    memoryPolicy: 'ORG',
    webPolicy: 'STANDARD',
    connectorPolicy: 'ORG_POLICY',
    agentPolicy: 'ORG_POLICY',
    marketplace: 'STANDARD',
    recommendedCategories: ['sales', 'marketing', 'operations', 'hr', 'finance-analysis', 'management', 'customer-service', 'research', 'reporting', 'automation'],
  },
  government: {
    ...base('government'),
    slug: 'government',
    audienceType: 'GOVERNMENT',
    enabled: true,
    supervisedOnly: false,
    defaultForNewUsers: false,
    defaultModelProfile: 'biina-gov',
    allowedCapabilities: ['chat', 'knowledge', 'files', 'web', 'research', 'agents', 'automations', 'connectors', 'memory', 'library'],
    recommendedCapabilities: ['knowledge', 'research', 'chat'],
    navigation: ['chat', 'knowledge', 'research', 'agents', 'automations', 'discover'],
    home: [
      { labelKey: 'orgKnowledge', target: 'knowledge', kind: 'route' },
      { labelKey: 'research', target: 'research', kind: 'route' },
      { labelKey: 'documentAnalysis', target: 'chat', kind: 'route' },
      { labelKey: 'reports', target: 'research', kind: 'route' },
    ],
    memoryPolicy: 'ORG',
    webPolicy: 'STANDARD',
    connectorPolicy: 'ORG_POLICY',
    agentPolicy: 'ORG_POLICY',
    // Sensitive deployments can be restricted to platform/organization-approved items.
    marketplace: 'CURATED_ONLY',
    recommendedCategories: ['policy', 'research', 'reports', 'document-analysis', 'service-design', 'public-communication', 'knowledge'],
  },
};

export function getExperienceProfile(id?: string | null): ExperienceProfile {
  if (id && id in EXPERIENCE_PROFILES) return EXPERIENCE_PROFILES[id as PersonaId];
  return EXPERIENCE_PROFILES.default;
}

/** Profiles a user may pick directly during onboarding (excludes supervised youth). */
export function listSelectableExperienceProfiles(): ExperienceProfile[] {
  return Object.values(EXPERIENCE_PROFILES).filter((p) => p.enabled && !p.supervisedOnly);
}

/** True when the profile allows a given product capability (before plan/policy gating). */
export function profileAllowsCapability(p: ExperienceProfile, cap: ProductCapability): boolean {
  return p.allowedCapabilities.includes(cap);
}
