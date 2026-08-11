import { describe, it, expect } from 'vitest';
import { getPersona, personas, listSelectablePersonas } from '@/config/personas';
import { primaryNav } from '@/config/navigation';

describe('persona architecture', () => {
  it('falls back to the default persona for unknown/empty ids', () => {
    expect(getPersona(undefined).id).toBe('default');
    expect(getPersona('not-real').id).toBe('default');
    expect(getPersona('kids').id).toBe('kids');
  });

  it('ships the default persona enabled and future personas defined but disabled', () => {
    expect(personas.default.enabled).toBe(true);
    expect(listSelectablePersonas().map((p) => p.id)).toContain('default');
    for (const id of ['kids', 'teens', 'campus', 'professional', 'business', 'government'] as const) {
      expect(personas[id]).toBeTruthy();
      expect(personas[id].enabled).toBe(false);
    }
  });
});

describe('navigation architecture', () => {
  it('has chat enabled and other areas scaffolded as disabled', () => {
    const chat = primaryNav.find((n) => n.key === 'chat');
    expect(chat?.enabled).toBe(true);
    const disabled = primaryNav.filter((n) => n.key !== 'chat');
    expect(disabled.every((n) => n.enabled === false)).toBe(true);
  });
});
