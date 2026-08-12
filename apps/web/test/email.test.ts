import { describe, it, expect, afterEach, vi } from 'vitest';
import { emailTemplates, devLinksEnabled } from '@/server/email';

/**
 * Email is provider-independent and must never leak token-bearing links in
 * production. These tests pin the safety-relevant behavior.
 */
const ORIGINAL = { ...process.env };
afterEach(() => {
  process.env = { ...ORIGINAL };
  vi.unstubAllEnvs();
});

describe('email templates', () => {
  it('carry the action URL and correct single-use / expiry wording', () => {
    const v = emailTemplates.verify('https://app/x?token=abc');
    expect(v.actionUrl).toBe('https://app/x?token=abc');
    expect(v.text).toContain('24 hours');

    const r = emailTemplates.reset('https://app/r?token=xyz');
    expect(r.text).toContain('1 hour');
    expect(r.text.toLowerCase()).toContain('once');

    const inv = emailTemplates.orgInvite('Acme', 'https://app/i?token=t');
    expect(inv.subject).toContain('Acme');
    expect(inv.actionUrl).toContain('token=t');
  });
});

describe('dev-link gating', () => {
  it('enabled outside production', () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('EMAIL_DEV_LINKS', '');
    expect(devLinksEnabled()).toBe(true);
  });

  it('disabled in production unless explicitly opted in', () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('EMAIL_DEV_LINKS', '');
    expect(devLinksEnabled()).toBe(false);

    vi.stubEnv('EMAIL_DEV_LINKS', 'true');
    expect(devLinksEnabled()).toBe(true);
  });
});
