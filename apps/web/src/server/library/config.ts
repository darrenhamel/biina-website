/**
 * Library / marketplace kill switches + hard limits (Phase 16).
 *
 * All default to a SAFE posture: the library is available, but PUBLIC self-publishing
 * and paid marketplace are OFF. Nothing here can be widened by item content or by a
 * persona — these are platform controls read from the environment.
 */

function flag(name: string, def: boolean): boolean {
  const v = process.env[name];
  if (v == null || v === '') return def;
  return v === 'true' || v === '1';
}

/** Master switch for the whole library/discovery experience. */
export function libraryEnabled(): boolean {
  return flag('LIBRARY_ENABLED', true);
}

/** Whether installing library items is allowed at all (platform-wide). */
export function libraryInstallationEnabled(): boolean {
  return flag('LIBRARY_INSTALLATION_ENABLED', true);
}

/** Whether PUBLIC-visibility items are surfaced to users. */
export function publicLibraryEnabled(): boolean {
  return flag('PUBLIC_LIBRARY_ENABLED', false);
}

/** Whether non-BIINA users/orgs may submit items for review. Off by default. */
export function publicCreatorPublishingEnabled(): boolean {
  return flag('PUBLIC_CREATOR_PUBLISHING_ENABLED', false);
}

/** Paid marketplace transactions — NOT implemented in Phase 16. Always effectively off. */
export function paidMarketplaceEnabled(): boolean {
  return flag('PAID_MARKETPLACE_ENABLED', false);
}

/** Experience profiles master switch. */
export function experienceProfilesEnabled(): boolean {
  return flag('EXPERIENCE_PROFILES_ENABLED', true);
}

/** A specific item can be suspended platform-wide via env (comma-separated slugs/ids). */
export function itemSuspendedByPlatform(slugOrId: string): boolean {
  const raw = process.env.LIBRARY_SUSPENDED_ITEMS ?? '';
  return raw.split(',').map((s) => s.trim()).filter(Boolean).includes(slugOrId);
}

/** Hard ceilings (server-authoritative; plan limits may be tighter, never looser). */
export const HARD_MAX_INSTALLED_AGENTS = 200;
export const HARD_MAX_INSTALLED_WORKFLOWS = 200;
export const SEARCH_PAGE_MAX = 50;
export const SEARCH_PAGE_DEFAULT = 24;

/**
 * HIGH_RISK executable patterns are NOT publishable in Phase 16, regardless of who
 * submits them. This is a structural rule, not a toggle.
 */
export const PUBLISHABLE_MAX_RISK = 'SCHEDULED_WRITE';
