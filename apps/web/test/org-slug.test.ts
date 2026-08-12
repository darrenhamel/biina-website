import { describe, it, expect } from 'vitest';
import { normalizeSlug, validateSlug, RESERVED_SLUGS } from '@/server/org/slug';

describe('organization slug normalization', () => {
  it('lowercases and hyphenates arbitrary input', () => {
    expect(normalizeSlug('  Acme Corp!  ')).toBe('acme-corp');
    expect(normalizeSlug('Foo___Bar')).toBe('foo-bar');
    expect(normalizeSlug('déjà vu')).toBe('d-j-vu'); // non-ascii dropped
  });

  it('collapses repeats and trims hyphens', () => {
    expect(normalizeSlug('--a--b--')).toBe('a-b');
  });

  it('caps at 48 characters', () => {
    expect(normalizeSlug('a'.repeat(80)).length).toBe(48);
  });
});

describe('organization slug validation', () => {
  it('accepts sound slugs', () => {
    for (const s of ['acme', 'acme-corp', 'team42', 'a1b2c3']) {
      expect(validateSlug(s)).toEqual({ ok: true });
    }
  });

  it('rejects too-short / too-long', () => {
    expect(validateSlug('ab')).toEqual({ ok: false, error: 'too_short' });
    expect(validateSlug('a'.repeat(49))).toEqual({ ok: false, error: 'too_long' });
  });

  it('rejects leading/trailing hyphen and bad chars', () => {
    expect(validateSlug('-abc').ok).toBe(false);
    expect(validateSlug('abc-').ok).toBe(false);
    expect(validateSlug('Abc').ok).toBe(false); // uppercase not allowed post-normalization
  });

  it('rejects double hyphens', () => {
    expect(validateSlug('a--b')).toEqual({ ok: false, error: 'double_hyphen' });
  });

  it('rejects reserved slugs (route squatting)', () => {
    for (const s of ['admin', 'api', 'app', 'login', 'billing', 'security']) {
      expect(RESERVED_SLUGS.has(s)).toBe(true);
      expect(validateSlug(s)).toEqual({ ok: false, error: 'reserved' });
    }
  });
});
