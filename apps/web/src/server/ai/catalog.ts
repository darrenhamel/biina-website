import { eq } from 'drizzle-orm';
import { getDb } from '@/server/db';
import { aiProviders, aiModels, aiRoutes, aiSettings } from '@/server/db/schema';
import type { AiProvider, AiModel } from '@/server/db/schema';

/**
 * AI config catalog + cache.
 *
 * The full control-plane configuration (providers, models, routes, settings) is
 * loaded into an in-memory snapshot with a short TTL, so routing does NOT query
 * the database per generated token. Admin writes call `invalidateAiConfig()` so
 * changes take effect immediately. Per-instance cache; safe under multi-instance
 * because the TTL is short and admin writes invalidate locally.
 */

export interface RoutesSnapshot {
  persona: Record<string, string>; // scopeKey -> modelId
  workload: Record<string, string>;
  plan: Record<string, string>;
}

export interface SettingsSnapshot {
  defaultModelId: string | null;
  fallbackEnabled: boolean;
  fallbackModelId: string | null;
  maintenanceMode: boolean;
  // Phase 5 — budget thresholds.
  currency: string;
  dailyCostWarn: number | null;
  dailyCostHardLimit: number | null;
  monthlyCostWarn: number | null;
  monthlyCostHardLimit: number | null;
  hardLimitEnabled: boolean;
}

export interface AiConfigSnapshot {
  providers: AiProvider[];
  models: AiModel[];
  routes: RoutesSnapshot;
  settings: SettingsSnapshot;
  loadedAt: number;
}

const TTL_MS = 5_000;
let cache: AiConfigSnapshot | null = null;

export function invalidateAiConfig(): void {
  cache = null;
}

export async function loadAiConfig(force = false): Promise<AiConfigSnapshot> {
  if (!force && cache && Date.now() - cache.loadedAt < TTL_MS) return cache;
  cache = await readAiConfig();
  return cache;
}

async function readAiConfig(): Promise<AiConfigSnapshot> {
  const db = getDb();
  const [providers, models, routeRows, settingsRows] = await Promise.all([
    db.select().from(aiProviders),
    db.select().from(aiModels),
    db.select().from(aiRoutes),
    db.select().from(aiSettings).where(eq(aiSettings.id, 'singleton')).limit(1),
  ]);

  const routes: RoutesSnapshot = { persona: {}, workload: {}, plan: {} };
  for (const r of routeRows) {
    routes[r.scope][r.scopeKey] = r.modelId;
  }

  const s = settingsRows[0];
  const settings: SettingsSnapshot = {
    defaultModelId: s?.defaultModelId ?? null,
    fallbackEnabled: s?.fallbackEnabled ?? false,
    fallbackModelId: s?.fallbackModelId ?? null,
    maintenanceMode: s?.maintenanceMode ?? false,
    currency: s?.currency ?? 'USD',
    dailyCostWarn: s?.dailyCostWarn ?? null,
    dailyCostHardLimit: s?.dailyCostHardLimit ?? null,
    monthlyCostWarn: s?.monthlyCostWarn ?? null,
    monthlyCostHardLimit: s?.monthlyCostHardLimit ?? null,
    hardLimitEnabled: s?.hardLimitEnabled ?? false,
  };

  return { providers, models, routes, settings, loadedAt: Date.now() };
}

// ---- Convenience lookups over a snapshot (pure) ----

export function modelById(snap: AiConfigSnapshot, id?: string | null): AiModel | undefined {
  if (!id) return undefined;
  return snap.models.find((m) => m.id === id);
}

export function modelBySlug(snap: AiConfigSnapshot, slug?: string | null): AiModel | undefined {
  if (!slug) return undefined;
  return snap.models.find((m) => m.slug === slug);
}

export function providerById(snap: AiConfigSnapshot, id?: string | null): AiProvider | undefined {
  if (!id) return undefined;
  return snap.providers.find((p) => p.id === id);
}
