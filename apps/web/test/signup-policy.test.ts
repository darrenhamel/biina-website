import { describe, it, expect } from 'vitest';
import { signupMode, parseAllowlist, isSignupAllowed } from '@/server/auth/signup-policy';

/**
 * Invite-only beta gate. The gate is server-enforced and fails CLOSED: in invite_only
 * mode an empty allowlist rejects everyone, and only exact-email or '@domain' matches
 * are admitted. `open` mode is a strict superset (everyone allowed) for dev/GA.
 */
describe('signup-policy', () => {
  const env = (o: Record<string, string | undefined>) => o as unknown as NodeJS.ProcessEnv;

  it('defaults to open when SIGNUP_MODE is unset', () => {
    expect(signupMode(env({}))).toBe('open');
    expect(isSignupAllowed('anyone@example.com', env({}))).toBe(true);
  });

  it('parses a comma/whitespace-separated allowlist, lower-cased', () => {
    expect(parseAllowlist('A@x.com, b@Y.com\n @Z.com')).toEqual(['a@x.com', 'b@y.com', '@z.com']);
    expect(parseAllowlist(undefined)).toEqual([]);
  });

  it('invite_only fails CLOSED with an empty allowlist', () => {
    const e = env({ SIGNUP_MODE: 'invite_only' });
    expect(signupMode(e)).toBe('invite_only');
    expect(isSignupAllowed('someone@example.com', e)).toBe(false);
  });

  it('invite_only admits exact emails (case-insensitive)', () => {
    const e = env({ SIGNUP_MODE: 'invite_only', SIGNUP_ALLOWLIST: 'founder@biina.ai, tester@x.com' });
    expect(isSignupAllowed('Founder@BIINA.ai', e)).toBe(true);
    expect(isSignupAllowed('tester@x.com', e)).toBe(true);
    expect(isSignupAllowed('stranger@x.com', e)).toBe(false);
  });

  it('invite_only admits a whole domain via a leading-@ entry', () => {
    const e = env({ SIGNUP_MODE: 'invite_only', SIGNUP_ALLOWLIST: '@biina.ai' });
    expect(isSignupAllowed('anyone@biina.ai', e)).toBe(true);
    expect(isSignupAllowed('anyone@evil.com', e)).toBe(false);
  });

  it('rejects malformed input in invite_only mode', () => {
    const e = env({ SIGNUP_MODE: 'invite_only', SIGNUP_ALLOWLIST: '@biina.ai' });
    expect(isSignupAllowed('no-at-sign', e)).toBe(false);
  });
});
