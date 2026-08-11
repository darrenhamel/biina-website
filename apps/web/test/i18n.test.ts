import { describe, it, expect } from 'vitest';
import { getDictionary } from '@/i18n/dictionaries';
import { locales } from '@/i18n/config';

function flatKeys(obj: Record<string, unknown>, prefix = ''): string[] {
  return Object.entries(obj).flatMap(([k, v]) => {
    const key = prefix ? `${prefix}.${k}` : k;
    return typeof v === 'object' && v !== null
      ? flatKeys(v as Record<string, unknown>, key)
      : [key];
  });
}

describe('i18n dictionaries', () => {
  it('defines a dictionary for every locale', () => {
    for (const l of locales) {
      expect(getDictionary(l)).toBeTruthy();
    }
  });

  it('English and Arabic have identical key structures (no missing translations)', () => {
    const en = flatKeys(getDictionary('en')).sort();
    const ar = flatKeys(getDictionary('ar')).sort();
    expect(ar).toEqual(en);
  });

  it('Arabic values are non-empty', () => {
    const ar = getDictionary('ar');
    expect(ar.chat.inputPlaceholder.length).toBeGreaterThan(0);
    expect(ar.landing.heroTitle).not.toBe('');
  });
});
