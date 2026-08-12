import { eq } from 'drizzle-orm';
import { getDb } from '@/server/db';
import { profiles } from '@/server/db/schema';
import type { Plan } from '@/server/db/schema';
import { AppError } from '@/lib/errors';
import { logSecurityEvent } from '@/server/auth/events';
import { getExperienceProfile, listSelectableExperienceProfiles, type ExperienceProfile } from '@/config/experience-profiles';
import { experienceProfilesEnabled } from '@/server/library/config';

/**
 * Experience-profile selection (Phase 16).
 *
 * The active experience profile is a TRUSTED, server-stored value on the user's
 * profile (`profiles.personaId`). The browser cannot claim a privileged Government/
 * Business experience simply by sending an id — selection is validated here, and even
 * a valid persona NEVER grants capability: entitlements + policy + safety still apply.
 * Supervised youth profiles (kids/teens) are not directly self-selectable.
 */

export async function getUserExperienceId(userId: string): Promise<string | null> {
  const [row] = await getDb().select({ personaId: profiles.personaId }).from(profiles).where(eq(profiles.userId, userId)).limit(1);
  return row?.personaId ?? null;
}

/** The resolved active profile, gated by the plan's allowed personas (empty = all). */
export function resolveActiveExperience(personaId: string | null | undefined, plan: Plan): ExperienceProfile {
  const profile = getExperienceProfile(personaId);
  const allowed = plan.allowedPersonas ?? [];
  if (allowed.length && !allowed.includes(profile.id)) {
    // Plan doesn't permit this persona → fall back to the default experience.
    return getExperienceProfile('default');
  }
  return profile;
}

/** Set the user's default experience profile after validation. */
export async function setUserExperience(userId: string, personaId: string, plan: Plan): Promise<ExperienceProfile> {
  if (!experienceProfilesEnabled()) throw new AppError(403, 'Experience profiles are not available.', 'experience_disabled');
  const profile = getExperienceProfile(personaId);
  if (profile.id !== personaId) throw new AppError(400, 'Unknown experience profile.', 'unknown_experience');
  // Only directly-selectable profiles (excludes supervised youth).
  const selectable = listSelectableExperienceProfiles().some((p) => p.id === personaId);
  if (!selectable) throw new AppError(403, 'This experience requires guardian setup and cannot be selected directly.', 'experience_supervised');
  const allowed = plan.allowedPersonas ?? [];
  if (allowed.length && !allowed.includes(profile.id)) throw new AppError(403, 'Your plan does not include this experience.', 'plan_no_experience');

  await getDb().update(profiles).set({ personaId, updatedAt: new Date() }).where(eq(profiles.userId, userId));
  await logSecurityEvent({ event: 'experience.changed', userId, metadata: { personaId } });
  return profile;
}

/** Onboarding option list: directly-selectable profiles, filtered by plan. */
export function onboardingChoices(plan: Plan): ExperienceProfile[] {
  const allowed = plan.allowedPersonas ?? [];
  return listSelectableExperienceProfiles().filter((p) => allowed.length === 0 || allowed.includes(p.id));
}
