/**
 * Persona architecture.
 *
 * BIINA will offer tailored experiences (prompts, permissions, layout accents,
 * enabled features) for different audiences. We do NOT build separate apps per
 * persona. Instead every persona is a DATA record here; the app reads the
 * active persona from the user's profile (`profiles.personaId`) and adapts.
 *
 * Phase 1 ships the definitions + a neutral default so nothing is hard-wired to
 * one audience. Later phases attach persona-specific system prompts, feature
 * gates, and theming by extending these records — no rebuild required.
 */

export type PersonaId =
  | 'default'
  | 'kids'
  | 'teens'
  | 'campus'
  | 'professional'
  | 'business'
  | 'government';

export interface PersonaConfig {
  id: PersonaId;
  /** i18n label keys are resolved in UI; these English/Arabic labels are for admin/config surfaces. */
  label: { en: string; ar: string };
  /** Minimum age band, used later for safety defaults. */
  ageBand?: string;
  /** Accent theme token override (maps to a CSS class later). Null = brand default. */
  accent: string | null;
  /**
   * Feature flags the persona MAY expose. The union across personas stays in
   * sync with config/navigation.ts. All false in Phase 1 except chat.
   */
  features: {
    chat: boolean;
    templates: boolean;
    projects: boolean;
    agents: boolean;
    files: boolean;
  };
  /** Whether this persona is selectable by end users yet. */
  enabled: boolean;
}

const baseFeatures = {
  chat: true,
  templates: false,
  projects: false,
  agents: false,
  files: false,
};

export const personas: Record<PersonaId, PersonaConfig> = {
  default: {
    id: 'default',
    label: { en: 'Default', ar: 'الافتراضي' },
    accent: null,
    features: { ...baseFeatures },
    enabled: true,
  },
  kids: {
    id: 'kids',
    label: { en: 'Kids', ar: 'الأطفال' },
    ageBand: '6–12',
    accent: 'persona-kids',
    features: { ...baseFeatures },
    enabled: false,
  },
  teens: {
    id: 'teens',
    label: { en: 'Teens', ar: 'المراهقون' },
    ageBand: '13–17',
    accent: 'persona-teens',
    features: { ...baseFeatures },
    enabled: false,
  },
  campus: {
    id: 'campus',
    label: { en: 'Campus / Students', ar: 'الجامعة / الطلاب' },
    accent: 'persona-campus',
    features: { ...baseFeatures },
    enabled: false,
  },
  professional: {
    id: 'professional',
    label: { en: 'Professionals', ar: 'المحترفون' },
    accent: 'persona-professional',
    features: { ...baseFeatures },
    enabled: false,
  },
  business: {
    id: 'business',
    label: { en: 'Business', ar: 'الأعمال' },
    accent: 'persona-business',
    features: { ...baseFeatures },
    enabled: false,
  },
  government: {
    id: 'government',
    label: { en: 'Government', ar: 'الحكومة' },
    accent: 'persona-government',
    features: { ...baseFeatures },
    enabled: false,
  },
};

export const defaultPersona = personas.default;

export function getPersona(id?: string | null): PersonaConfig {
  if (id && id in personas) return personas[id as PersonaId];
  return defaultPersona;
}

export function listSelectablePersonas(): PersonaConfig[] {
  return Object.values(personas).filter((p) => p.enabled);
}
