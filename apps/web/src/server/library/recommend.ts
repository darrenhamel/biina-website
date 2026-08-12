import { getExperienceProfile } from '@/config/experience-profiles';
import type { LibraryItem, Plan } from '@/server/db/schema';
import { searchItems } from './items';
import type { LibraryViewer } from './access';

/**
 * Explainable discovery recommendations. Signals are COARSE and non-invasive: active
 * persona, plan, and language — never private conversation content or sensitive
 * memory. Every recommendation carries a plain-language reason.
 */

export interface Recommendation {
  item: LibraryItem;
  reason: string; // high-level, explainable
}

export interface DiscoverSection {
  key: string;
  items: LibraryItem[];
}

/** Build the persona-aware "For You" + category sections for the Discover page. */
export async function buildDiscovery(viewer: LibraryViewer, persona: string | null, plan: Plan, locale: string): Promise<{ featured: LibraryItem[]; forYou: Recommendation[]; sections: DiscoverSection[] }> {
  const profile = getExperienceProfile(persona);

  const featuredRes = await searchItems(viewer, { verifiedOnly: true, page: 0, pageSize: 12 });
  const featured = featuredRes.items.filter((i) => i.featured).slice(0, 8);

  // For You: items supporting this persona, gated by plan already at query level.
  const personaRes = await searchItems(viewer, { persona: profile.slug, page: 0, pageSize: 12 });
  const forYou: Recommendation[] = personaRes.items.slice(0, 8).map((item) => ({
    item,
    reason: reasonFor(item, profile.slug, plan, locale),
  }));

  // A section per recommended category for this persona.
  const sections: DiscoverSection[] = [];
  for (const cat of profile.recommendedCategories.slice(0, 6)) {
    const res = await searchItems(viewer, { category: cat, page: 0, pageSize: 8 });
    if (res.items.length) sections.push({ key: cat, items: res.items });
  }

  return { featured, forYou, sections };
}

function reasonFor(item: LibraryItem, persona: string, plan: Plan, locale: string): string {
  const ar = locale === 'ar';
  if (item.verified) return ar ? 'موصى به من BIINA' : 'Recommended by BIINA';
  if (item.supportedPersonas.includes(persona)) return ar ? 'مناسب لتجربتك' : 'Matches your experience';
  if (item.requiredPlans.length && item.requiredPlans.includes(plan.slug)) return ar ? 'متاح ضمن خطتك' : 'Included in your plan';
  return ar ? 'شائع في المكتبة' : 'Popular in the library';
}
