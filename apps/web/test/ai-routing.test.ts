import { describe, it, expect } from 'vitest';
import { isGatewayError } from '@biina/ai-gateway';
import type { AiModel, AiProvider } from '@/server/db/schema';
import type { AiConfigSnapshot } from '@/server/ai/catalog';
import { selectRoute, selectFallback, validateConfig, isModelUsable } from '@/server/ai/routing';

/**
 * Routing engine is a PURE function over a config snapshot, so these tests build
 * synthetic snapshots — no database required.
 */

function provider(over: Partial<AiProvider> & { id: string; type: AiProvider['type'] }): AiProvider {
  return {
    slug: over.id,
    displayName: over.id,
    enabled: true,
    maintenanceMode: false,
    healthState: 'ok',
    healthDetail: null,
    healthCheckedAt: null,
    priority: 100,
    baseUrlEnvRef: null,
    apiKeyEnvRef: null,
    region: null,
    supportsStreaming: true,
    supportsChat: true,
    supportsTools: false,
    supportsVision: false,
    createdAt: new Date(0),
    updatedAt: new Date(0),
    maintenanceNote: null,
    ...over,
  } as unknown as AiProvider;
}

function model(over: Partial<AiModel> & { id: string; slug: string; providerId: string }): AiModel {
  return {
    displayName: over.slug,
    description: null,
    providerModelId: `infra-${over.slug}`,
    enabled: true,
    visibleToUsers: true,
    adminOnly: false,
    maintenanceMode: false,
    maintenanceNote: null,
    capabilities: { chat: true, streaming: true },
    contextWindow: null,
    maxOutputTokens: null,
    priority: 100,
    estimatedInputCost: null,
    estimatedOutputCost: null,
    infraCostClass: null,
    avgLatencyMs: null,
    avgTtftMs: null,
    recentErrorRate: null,
    dataResidency: null,
    createdAt: new Date(0),
    updatedAt: new Date(0),
    ...over,
  } as unknown as AiModel;
}

function snap(parts: {
  providers: AiProvider[];
  models: AiModel[];
  routes?: Partial<AiConfigSnapshot['routes']>;
  settings?: Partial<AiConfigSnapshot['settings']>;
}): AiConfigSnapshot {
  return {
    providers: parts.providers,
    models: parts.models,
    routes: { persona: {}, workload: {}, plan: {}, ...parts.routes },
    settings: { defaultModelId: null, fallbackEnabled: false, fallbackModelId: null, maintenanceMode: false, ...parts.settings },
    loadedAt: 0,
  };
}

const pMock = provider({ id: 'prov-mock', type: 'mock' });
const pCloud = provider({ id: 'prov-cloud', type: 'openai-compatible' });

describe('selectRoute — priority', () => {
  it('uses the default model when nothing else applies', () => {
    const biina = model({ id: 'm1', slug: 'biina', providerId: pMock.id });
    const d = selectRoute({}, snap({ providers: [pMock], models: [biina], settings: { defaultModelId: 'm1' } }));
    expect(d.biinaModelSlug).toBe('biina');
    expect(d.providerType).toBe('mock');
    expect(d.providerModel).toBe('infra-biina');
    expect(d.reason).toBe('default');
  });

  it('persona route beats default', () => {
    const biina = model({ id: 'm1', slug: 'biina', providerId: pMock.id });
    const kids = model({ id: 'm2', slug: 'biina-safe', providerId: pMock.id });
    const d = selectRoute(
      { persona: 'kids' },
      snap({ providers: [pMock], models: [biina, kids], routes: { persona: { kids: 'm2' } }, settings: { defaultModelId: 'm1' } }),
    );
    expect(d.biinaModelSlug).toBe('biina-safe');
    expect(d.reason).toBe('persona:kids');
  });

  it('workload route is used when set', () => {
    const biina = model({ id: 'm1', slug: 'biina', providerId: pMock.id });
    const fast = model({ id: 'm2', slug: 'biina-fast', providerId: pMock.id });
    const d = selectRoute(
      { workload: 'fast-chat' },
      snap({ providers: [pMock], models: [biina, fast], routes: { workload: { 'fast-chat': 'm2' } }, settings: { defaultModelId: 'm1' } }),
    );
    expect(d.biinaModelSlug).toBe('biina-fast');
  });

  it('explicit approved (visible) model override wins', () => {
    const biina = model({ id: 'm1', slug: 'biina', providerId: pMock.id });
    const fast = model({ id: 'm2', slug: 'biina-fast', providerId: pMock.id, visibleToUsers: true });
    const d = selectRoute(
      { requestedModelSlug: 'biina-fast' },
      snap({ providers: [pMock], models: [biina, fast], settings: { defaultModelId: 'm1' } }),
    );
    expect(d.biinaModelSlug).toBe('biina-fast');
    expect(d.reason).toBe('explicit model override');
  });

  it('rejects an override for a hidden model (non-admin) with a clear error', () => {
    const biina = model({ id: 'm1', slug: 'biina', providerId: pMock.id });
    const hidden = model({ id: 'm2', slug: 'secret', providerId: pMock.id, visibleToUsers: false });
    try {
      selectRoute({ requestedModelSlug: 'secret' }, snap({ providers: [pMock], models: [biina, hidden], settings: { defaultModelId: 'm1' } }));
      throw new Error('should throw');
    } catch (err) {
      expect(isGatewayError(err) && err.code).toBe('invalid_config');
    }
  });

  it('admin may override to an admin-only model', () => {
    const biina = model({ id: 'm1', slug: 'biina', providerId: pMock.id });
    const adminModel = model({ id: 'm2', slug: 'biina-local', providerId: pMock.id, visibleToUsers: false, adminOnly: true });
    const d = selectRoute({ requestedModelSlug: 'biina-local', isAdmin: true }, snap({ providers: [pMock], models: [biina, adminModel], settings: { defaultModelId: 'm1' } }));
    expect(d.biinaModelSlug).toBe('biina-local');
  });
});

describe('selectRoute — validity & fail-safe', () => {
  it('skips a disabled model and falls through to default', () => {
    const def = model({ id: 'm1', slug: 'biina', providerId: pMock.id });
    const disabled = model({ id: 'm2', slug: 'off', providerId: pMock.id, enabled: false });
    const d = selectRoute(
      { persona: 'kids' },
      snap({ providers: [pMock], models: [def, disabled], routes: { persona: { kids: 'm2' } }, settings: { defaultModelId: 'm1' } }),
    );
    expect(d.biinaModelSlug).toBe('biina'); // fell back to default
  });

  it('skips a model whose provider is disabled', () => {
    const disabledProv = provider({ id: 'prov-x', type: 'openai-compatible', enabled: false });
    const onDisabled = model({ id: 'm1', slug: 'cloud', providerId: 'prov-x' });
    const onMock = model({ id: 'm2', slug: 'biina', providerId: pMock.id });
    const d = selectRoute(
      {},
      snap({ providers: [disabledProv, pMock], models: [onDisabled, onMock], routes: { persona: { default: 'm1' } }, settings: { defaultModelId: 'm2' } }),
    );
    expect(d.providerType).toBe('mock');
  });

  it('throws invalid_config when no usable model exists', () => {
    const def = model({ id: 'm1', slug: 'biina', providerId: pMock.id, enabled: false });
    try {
      selectRoute({}, snap({ providers: [pMock], models: [def], settings: { defaultModelId: 'm1' } }));
      throw new Error('should throw');
    } catch (err) {
      expect(isGatewayError(err) && err.code).toBe('invalid_config');
    }
  });

  it('rejects a route that cannot satisfy a required capability (reasoning)', () => {
    // Default lacks "reasoning"; only the reasoning model has it.
    const plain = model({ id: 'm1', slug: 'biina', providerId: pMock.id, capabilities: { chat: true, streaming: true } });
    const reason = model({ id: 'm2', slug: 'biina-reason', providerId: pMock.id, capabilities: { chat: true, streaming: true, reasoning: true } });
    const d = selectRoute(
      { workload: 'reasoning' },
      snap({ providers: [pMock], models: [plain, reason], routes: { workload: { reasoning: 'm2' } }, settings: { defaultModelId: 'm1' } }),
    );
    expect(d.biinaModelSlug).toBe('biina-reason');

    // If the reasoning model is disabled, default lacks capability → no usable model.
    const reasonOff = model({ id: 'm2', slug: 'biina-reason', providerId: pMock.id, enabled: false, capabilities: { chat: true, streaming: true, reasoning: true } });
    expect(() =>
      selectRoute({ workload: 'reasoning' }, snap({ providers: [pMock], models: [plain, reasonOff], routes: { workload: { reasoning: 'm2' } }, settings: { defaultModelId: 'm1' } })),
    ).toThrow();
  });

  it('global maintenance mode blocks all routing', () => {
    const def = model({ id: 'm1', slug: 'biina', providerId: pMock.id });
    expect(() => selectRoute({}, snap({ providers: [pMock], models: [def], settings: { defaultModelId: 'm1', maintenanceMode: true } }))).toThrow();
  });
});

describe('selectFallback — loop protection', () => {
  const primaryModel = model({ id: 'm1', slug: 'biina', providerId: pCloud.id });
  const primaryDecision = {
    model: primaryModel,
    provider: pCloud,
    providerType: 'openai-compatible' as const,
    providerModel: 'infra-biina',
    biinaModelSlug: 'biina',
    displayName: 'BIINA',
    reason: 'default',
    fallbackUsed: false,
  };

  it('returns null when fallback is disabled', () => {
    const s = snap({ providers: [pCloud, pMock], models: [primaryModel], settings: { fallbackEnabled: false } });
    expect(selectFallback(s, primaryDecision)).toBeNull();
  });

  it('returns a different-provider fallback when enabled', () => {
    const fb = model({ id: 'm2', slug: 'biina-local', providerId: pMock.id });
    const s = snap({ providers: [pCloud, pMock], models: [primaryModel, fb], settings: { fallbackEnabled: true, fallbackModelId: 'm2' } });
    const d = selectFallback(s, primaryDecision);
    expect(d?.biinaModelSlug).toBe('biina-local');
    expect(d?.fallbackUsed).toBe(true);
  });

  it('refuses a fallback on the SAME provider (loop guard)', () => {
    const sameProv = model({ id: 'm2', slug: 'biina-2', providerId: pCloud.id });
    const s = snap({ providers: [pCloud], models: [primaryModel, sameProv], settings: { fallbackEnabled: true, fallbackModelId: 'm2' } });
    expect(selectFallback(s, primaryDecision)).toBeNull();
  });

  it('refuses a fallback that references the primary model itself', () => {
    const s = snap({ providers: [pCloud, pMock], models: [primaryModel], settings: { fallbackEnabled: true, fallbackModelId: 'm1' } });
    expect(selectFallback(s, primaryDecision)).toBeNull();
  });
});

describe('validateConfig', () => {
  it('flags a missing default, dangling routes, and self-referential fallback', () => {
    const def = model({ id: 'm1', slug: 'biina', providerId: pMock.id });
    const problems = validateConfig(
      snap({
        providers: [pMock],
        models: [def],
        routes: { persona: { kids: 'missing-id' } },
        settings: { defaultModelId: 'm1', fallbackEnabled: true, fallbackModelId: 'm1' },
      }),
    );
    expect(problems.some((p) => /persona route "kids"/.test(p))).toBe(true);
    expect(problems.some((p) => /Fallback model is the same/.test(p))).toBe(true);
  });

  it('returns no problems for a healthy config', () => {
    const def = model({ id: 'm1', slug: 'biina', providerId: pMock.id });
    expect(validateConfig(snap({ providers: [pMock], models: [def], settings: { defaultModelId: 'm1' } }))).toEqual([]);
  });
});

describe('isModelUsable', () => {
  it('honors visibility only for overrides', () => {
    const hidden = model({ id: 'm1', slug: 'x', providerId: pMock.id, visibleToUsers: false });
    expect(isModelUsable(hidden, pMock, ['chat'], {})).toBe(true); // internal route
    expect(isModelUsable(hidden, pMock, ['chat'], { forOverride: true })).toBe(false); // user override
    expect(isModelUsable(hidden, pMock, ['chat'], { forOverride: true, isAdmin: true })).toBe(true);
  });
});
