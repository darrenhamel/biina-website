/**
 * Organization slug rules — pure & testable.
 *
 * Slugs are stable, URL-safe identifiers (never the mutable display name).
 * Reserved words protect existing/first-party routes from being shadowed.
 */

export const RESERVED_SLUGS = new Set([
  'admin', 'api', 'app', 'org', 'orgs', 'organization', 'organizations', 'settings',
  'login', 'logout', 'signup', 'signin', 'register', 'usage', 'chat', 'account',
  'new', 'create', 'help', 'support', 'about', 'biina', 'www', 'mail', 'root',
  'system', 'null', 'undefined', 'static', 'public', 'assets', 'security',
  'members', 'invite', 'invitations', 'billing', 'plans', 'verify', 'reset',
]);

const SLUG_RE = /^[a-z0-9]([a-z0-9-]{1,46}[a-z0-9])?$/; // 3-48 chars, no leading/trailing hyphen

export function normalizeSlug(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-')
    .slice(0, 48);
}

export type SlugError = 'too_short' | 'too_long' | 'invalid_chars' | 'reserved' | 'double_hyphen';

export function validateSlug(slug: string): { ok: true } | { ok: false; error: SlugError } {
  if (slug.length < 3) return { ok: false, error: 'too_short' };
  if (slug.length > 48) return { ok: false, error: 'too_long' };
  if (slug.includes('--')) return { ok: false, error: 'double_hyphen' };
  if (!SLUG_RE.test(slug)) return { ok: false, error: 'invalid_chars' };
  if (RESERVED_SLUGS.has(slug)) return { ok: false, error: 'reserved' };
  return { ok: true };
}
