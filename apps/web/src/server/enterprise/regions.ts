/**
 * Region vocabulary for data-residency + regional routing (Phase 17).
 *
 * Regions are stable internal identifiers, NOT compliance claims. A provider being
 * tagged `UAE` means it is CONFIGURED as UAE-hosted; it is not evidence of any
 * certification. Real residency is proven by infrastructure + review, not metadata.
 */

export const REGIONS = ['UAE', 'EU', 'US', 'OTHER'] as const;
export type Region = (typeof REGIONS)[number];

export function isRegion(v: string | null | undefined): v is Region {
  return v != null && (REGIONS as readonly string[]).includes(v);
}

export function normalizeRegion(v: string | null | undefined): Region {
  return isRegion(v) ? v : 'OTHER';
}
