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
  it('has the shipped areas enabled and future areas scaffolded as disabled', () => {
    // Shipped, usable areas (chat since Phase 1; knowledge since Phase 8).
    const shipped = new Set(['chat', 'knowledge']);
    for (const key of shipped) {
      expect(primaryNav.find((n) => n.key === key)?.enabled).toBe(true);
    }
    // Everything else is scaffolded (disabled) for a future phase.
    const rest = primaryNav.filter((n) => !shipped.has(n.key));
    expect(rest.every((n) => n.enabled === false)).toBe(true);
  });
});
