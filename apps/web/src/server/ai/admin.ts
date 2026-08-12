import { and, desc, eq } from 'drizzle-orm';
import { getProvider } from '@biina/ai-gateway';
import { getDb } from '@/server/db';
import { aiProviders, aiModels, aiRoutes, aiSettings, users } from '@/server/db/schema';
import type { AiModel } from '@/server/db/schema';
import { invalidateAiConfig, loadAiConfig } from './catalog';
import { validateConfig } from './routing';
import { metricsSnapshot } from './metrics';
import { writeAudit, recentAudit } from './audit';
import { GatewayError } from '@biina/ai-gateway';

const SETTINGS_ID = 'singleton';

/** Redact provider secrets: expose only the env-var NAMES and whether they're set. */
function redactProvider(p: typeof aiProviders.$inferSelect) {
  return {
    id: p.id,
    slug: p.slug,
    displayName: p.displayName,
    type: p.type,
    enabled: p.enabled,
    maintenanceMode: p.maintenanceMode,
    maintenanceNote: p.maintenanceNote,
    healthState: p.healthState,
    healthDetail: p.healthDetail,
    healthCheckedAt: p.healthCheckedAt,
    priority: p.priority,
    region: p.region,
    supports: {
      streaming: p.supportsStreaming,
      chat: p.supportsChat,
      tools: p.supportsTools,
      vision: p.supportsVision,
    },
    // NON-secret: names + presence only. Never the values.
    baseUrl: p.baseUrlEnvRef ? { envRef: p.baseUrlEnvRef, configured: Boolean(process.env[p.baseUrlEnvRef]) } : null,
    apiKey: p.apiKeyEnvRef ? { envRef: p.apiKeyEnvRef, configured: Boolean(process.env[p.apiKeyEnvRef]) } : null,
  };
}

function shapeModel(m: AiModel, providerSlug?: string) {
  return {
    id: m.id,
    slug: m.slug,
    displayName: m.displayName,
    description: m.description,
    providerId: m.providerId,
    providerSlug,
    providerModelId: m.providerModelId, // admin-only surface
    enabled: m.enabled,
    visibleToUsers: m.visibleToUsers,
    adminOnly: m.adminOnly,
    maintenanceMode: m.maintenanceMode,
    maintenanceNote: m.maintenanceNote,
    capabilities: m.capabilities,
    contextWindow: m.contextWindow,
    maxOutputTokens: m.maxOutputTokens,
    priority: m.priority,
    infraCostClass: m.infraCostClass,
    avgLatencyMs: m.avgLatencyMs,
    avgTtftMs: m.avgTtftMs,
    recentErrorRate: m.recentErrorRate,
  };
}

/** Full admin catalog view (secrets redacted) for the control page. */
export async function getAdminCatalog() {
  const snap = await loadAiConfig(true);
  const providerBySlug = new Map(snap.providers.map((p) => [p.id, p.slug] as const));
  const defaultModel = snap.models.find((m) => m.id === snap.settings.defaultModelId);
  const fallbackModel = snap.models.find((m) => m.id === snap.settings.fallbackModelId);
  const slugFor = (id: string | null) => snap.models.find((m) => m.id === id)?.slug ?? null;

  return {
    settings: {
      defaultModelSlug: defaultModel?.slug ?? null,
      fallbackEnabled: snap.settings.fallbackEnabled,
      fallbackModelSlug: fallbackModel?.slug ?? null,
      maintenanceMode: snap.settings.maintenanceMode,
    },
    providers: snap.providers
      .slice()
      .sort((a, b) => a.priority - b.priority)
      .map(redactProvider),
    models: snap.models
      .slice()
      .sort((a, b) => a.priority - b.priority)
      .map((m) => shapeModel(m, providerBySlug.get(m.providerId))),
    routes: {
      persona: Object.fromEntries(Object.entries(snap.routes.persona).map(([k, v]) => [k, slugFor(v)])),
      workload: Object.fromEntries(Object.entries(snap.routes.workload).map(([k, v]) => [k, slugFor(v)])),
      plan: Object.fromEntries(Object.entries(snap.routes.plan).map(([k, v]) => [k, slugFor(v)])),
    },
    problems: validateConfig(snap),
    metrics: metricsSnapshot(),
    audit: await recentAudit(15),
  };
}

/** Probe each ENABLED provider's health and persist it. Returns nothing sensitive. */
export async function refreshProviderHealth(): Promise<void> {
  const snap = await loadAiConfig(true);
  const db = getDb();
  await Promise.all(
    snap.providers
      .filter((p) => p.enabled)
      .map(async (p) => {
        try {
          const h = await getProvider(p.type).health();
          await db
            .update(aiProviders)
            .set({
              healthState: h.ok ? 'ok' : 'error',
              healthDetail: h.detail ?? null,
              healthCheckedAt: new Date(),
            })
            .where(eq(aiProviders.id, p.id));
        } catch {
          await db
            .update(aiProviders)
            .set({ healthState: 'error', healthDetail: 'health check failed', healthCheckedAt: new Date() })
            .where(eq(aiProviders.id, p.id));
        }
      }),
  );
  invalidateAiConfig();
}

/** Best-effort: mark a provider's health after a runtime outcome. */
export async function markProviderHealth(providerType: string, ok: boolean, detail?: string): Promise<void> {
  try {
    await getDb()
      .update(aiProviders)
      .set({ healthState: ok ? 'ok' : 'error', healthDetail: detail ?? null, healthCheckedAt: new Date() })
      .where(eq(aiProviders.type, providerType as never));
    invalidateAiConfig();
  } catch {
    /* non-critical */
  }
}

// ---- Mutations (all audited + cache-invalidating) ----

export async function updateModel(id: string, patch: Record<string, unknown>, adminUserId: string) {
  const db = getDb();
  const [prev] = await db.select().from(aiModels).where(eq(aiModels.id, id)).limit(1);
  if (!prev) throw new GatewayError('invalid_config', 'Model not found');

  const set: Record<string, unknown> = { updatedAt: new Date() };
  if (patch.capabilities) {
    set.capabilities = { ...(prev.capabilities ?? {}), ...(patch.capabilities as Record<string, boolean>) };
  }
  for (const key of [
    'enabled',
    'displayName',
    'description',
    'visibleToUsers',
    'adminOnly',
    'maintenanceMode',
    'maintenanceNote',
    'priority',
    'providerModelId',
  ] as const) {
    if (patch[key] !== undefined) set[key] = patch[key];
  }

  await db.update(aiModels).set(set).where(eq(aiModels.id, id));
  invalidateAiConfig();
  await writeAudit({
    adminUserId,
    action: 'model.update',
    targetType: 'model',
    targetId: prev.slug,
    previousValue: pickAudit(prev, Object.keys(set)),
    newValue: set,
  });
  return { ok: true };
}

export async function updateProvider(id: string, patch: Record<string, unknown>, adminUserId: string) {
  const db = getDb();
  const [prev] = await db.select().from(aiProviders).where(eq(aiProviders.id, id)).limit(1);
  if (!prev) throw new GatewayError('invalid_config', 'Provider not found');

  const set: Record<string, unknown> = { updatedAt: new Date() };
  for (const key of ['enabled', 'maintenanceMode', 'maintenanceNote', 'priority'] as const) {
    if (patch[key] !== undefined) set[key] = patch[key];
  }
  await db.update(aiProviders).set(set).where(eq(aiProviders.id, id));
  invalidateAiConfig();
  await writeAudit({
    adminUserId,
    action: 'provider.update',
    targetType: 'provider',
    targetId: prev.slug,
    previousValue: pickAudit(prev, Object.keys(set)),
    newValue: set,
  });
  return { ok: true };
}

export async function updateRouting(patch: Record<string, unknown>, adminUserId: string) {
  const db = getDb();
  const models = await db.select({ id: aiModels.id, slug: aiModels.slug }).from(aiModels);
  const idBySlug = new Map(models.map((m) => [m.slug, m.id] as const));
  const resolve = (slug: unknown): string | null => {
    if (slug === null || slug === undefined) return null;
    const id = idBySlug.get(String(slug));
    if (!id) throw new GatewayError('invalid_config', `Unknown model "${slug}"`);
    return id;
  };

  const [prev] = await db.select().from(aiSettings).where(eq(aiSettings.id, SETTINGS_ID)).limit(1);

  // Settings (default / fallback / maintenance).
  const settingsSet: Record<string, unknown> = { updatedAt: new Date() };
  if ('defaultModelSlug' in patch) settingsSet.defaultModelId = resolve(patch.defaultModelSlug);
  if ('fallbackModelSlug' in patch) settingsSet.fallbackModelId = resolve(patch.fallbackModelSlug);
  if (patch.fallbackEnabled !== undefined) settingsSet.fallbackEnabled = patch.fallbackEnabled;
  if (patch.maintenanceMode !== undefined) settingsSet.maintenanceMode = patch.maintenanceMode;
  if (Object.keys(settingsSet).length > 1) {
    await db
      .insert(aiSettings)
      .values({ id: SETTINGS_ID, ...settingsSet })
      .onConflictDoUpdate({ target: aiSettings.id, set: settingsSet });
  }

  // Scope route maps (upsert on value, delete on null).
  const applyScope = async (scope: 'persona' | 'workload' | 'plan', map?: Record<string, unknown>) => {
    if (!map) return;
    for (const [key, slug] of Object.entries(map)) {
      const modelId = resolve(slug);
      if (modelId === null) {
        await db.delete(aiRoutes).where(and(eq(aiRoutes.scope, scope), eq(aiRoutes.scopeKey, key)));
      } else {
        await db
          .insert(aiRoutes)
          .values({ scope, scopeKey: key, modelId })
          .onConflictDoUpdate({ target: [aiRoutes.scope, aiRoutes.scopeKey], set: { modelId, updatedAt: new Date() } });
      }
    }
  };
  await applyScope('persona', patch.personaRoutes as Record<string, unknown> | undefined);
  await applyScope('workload', patch.workloadRoutes as Record<string, unknown> | undefined);
  await applyScope('plan', patch.planRoutes as Record<string, unknown> | undefined);

  invalidateAiConfig();
  await writeAudit({
    adminUserId,
    action: 'routing.update',
    targetType: 'routing',
    targetId: 'global',
    previousValue: prev ? { defaultModelId: prev.defaultModelId, fallbackEnabled: prev.fallbackEnabled, fallbackModelId: prev.fallbackModelId, maintenanceMode: prev.maintenanceMode } : null,
    newValue: { settings: settingsSet, personaRoutes: patch.personaRoutes, workloadRoutes: patch.workloadRoutes, planRoutes: patch.planRoutes },
  });
  return { ok: true };
}

/** Update platform budget thresholds (ai_settings singleton). */
export async function updateBudget(patch: Record<string, unknown>, adminUserId: string) {
  const db = getDb();
  const [prev] = await db.select().from(aiSettings).where(eq(aiSettings.id, SETTINGS_ID)).limit(1);
  const set: Record<string, unknown> = { updatedAt: new Date() };
  for (const key of [
    'currency',
    'dailyCostWarn',
    'dailyCostHardLimit',
    'monthlyCostWarn',
    'monthlyCostHardLimit',
    'hardLimitEnabled',
  ] as const) {
    if (patch[key] !== undefined) set[key] = patch[key];
  }
  await db
    .insert(aiSettings)
    .values({ id: SETTINGS_ID, ...set })
    .onConflictDoUpdate({ target: aiSettings.id, set });
  invalidateAiConfig();
  await writeAudit({
    adminUserId,
    action: 'budget.update',
    targetType: 'budget',
    targetId: 'global',
    previousValue: prev
      ? {
          dailyCostWarn: prev.dailyCostWarn,
          dailyCostHardLimit: prev.dailyCostHardLimit,
          monthlyCostWarn: prev.monthlyCostWarn,
          monthlyCostHardLimit: prev.monthlyCostHardLimit,
          hardLimitEnabled: prev.hardLimitEnabled,
        }
      : null,
    newValue: set,
  });
  return { ok: true };
}

/** List users with their plan (for admin plan assignment). No secrets/content. */
export async function listUsers(limit = 100) {
  return getDb()
    .select({
      id: users.id,
      email: users.email,
      role: users.role,
      plan: users.plan,
      createdAt: users.createdAt,
    })
    .from(users)
    .orderBy(desc(users.createdAt))
    .limit(limit);
}

function pickAudit(row: Record<string, unknown>, keys: string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of keys) if (k !== 'updatedAt' && k in row) out[k] = row[k];
  return out;
}
