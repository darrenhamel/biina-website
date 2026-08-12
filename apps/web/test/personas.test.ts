import { describe, it, expect } from 'vitest';
import { getPersona, personas, listSelectablePersonas } from '@/config/personas';
import { primaryNav } from '@/config/navigation';

describe('persona architecture', () => {
  it('falls back to the default persona for unknown/empty ids', () => {
    expect(getPersona(undefined).id).toBe('default');
    expect(getPersona('not-real').id).toBe('default');
    expect(getPersona('kids').id).toBe('kids');
  });

  it('ships adult personas selectable (Phase 16) and keeps youth personas supervised', () => {
    expect(personas.default.enabled).toBe(true);
    expect(listSelectablePersonas().map((p) => p.id)).toContain('default');
    // Phase 16 — adult experiences are now directly selectable.
    for (const id of ['campus', 'professional', 'business', 'government'] as const) {
      expect(personas[id].enabled).toBe(true);
    }
    // Kids/Teens remain defined but NOT directly self-selectable (supervised setup).
    for (const id of ['kids', 'teens'] as const) {
      expect(personas[id]).toBeTruthy();
      expect(personas[id].enabled).toBe(false);
    }
  });
});

describe('navigation architecture', () => {
  it('has the shipped areas enabled and future areas scaffolded as disabled', () => {
    // Shipped, usable areas (chat since Phase 1; knowledge since Phase 8; agents since
    // Phase 11; automations since Phase 12).
    const shipped = new Set(['chat', 'knowledge', 'agents', 'research', 'automations', 'discover']);
    for (const key of shipped) {
      expect(primaryNav.find((n) => n.key === key)?.enabled).toBe(true);
    }
    // Everything else is scaffolded (disabled) for a future phase.
    const rest = primaryNav.filter((n) => !shipped.has(n.key));
    expect(rest.every((n) => n.enabled === false)).toBe(true);
  });
});
