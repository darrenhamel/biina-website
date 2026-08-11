import type { AIProvider, ModelDescriptor, ProviderName } from './types';
import { MockProvider } from './providers/mock';

/**
 * Central model registry + provider resolution.
 *
 * ONE place maps logical model ids -> provider. Nothing else in the app hard-codes
 * a model name. `AI_DEFAULT_PROVIDER` / `AI_DEFAULT_MODEL` (env) choose the default.
 *
 * Phase 1 ships only the `mock` provider. Phase 2 adds `ollama` and
 * `openai-compatible` here; the app above this line does not change.
 */

export interface GatewayConfig {
  defaultProvider: ProviderName;
  defaultModel: string;
}

const MODELS: ModelDescriptor[] = [
  {
    id: 'biina-dev',
    label: 'BIINA (development)',
    provider: 'mock',
    contextTokens: 8192,
  },
];

// Lazily instantiated singletons.
const providerInstances: Partial<Record<ProviderName, AIProvider>> = {};

function instantiate(name: ProviderName): AIProvider {
  switch (name) {
    case 'mock':
      return new MockProvider();
    // Phase 2:
    // case 'ollama': return new OllamaProvider(...)
    // case 'openai-compatible': return new OpenAICompatibleProvider(...)
    default:
      // Unknown providers fall back to the mock so the app never talks to a
      // vendor it wasn't configured for. Phase 2 makes this an explicit error.
      return new MockProvider();
  }
}

export function getConfig(): GatewayConfig {
  const env = typeof process !== 'undefined' ? process.env : ({} as NodeJS.ProcessEnv);
  return {
    defaultProvider: (env.AI_DEFAULT_PROVIDER as ProviderName) || 'mock',
    defaultModel: env.AI_DEFAULT_MODEL || 'biina-dev',
  };
}

export function listModels(): ModelDescriptor[] {
  return MODELS.slice();
}

export function resolveModel(modelId?: string): ModelDescriptor {
  const { defaultModel } = getConfig();
  const id = modelId || defaultModel;
  return MODELS.find((m) => m.id === id) ?? MODELS[0];
}

export function getProvider(name?: ProviderName): AIProvider {
  const providerName = name || getConfig().defaultProvider;
  if (!providerInstances[providerName]) {
    providerInstances[providerName] = instantiate(providerName);
  }
  return providerInstances[providerName]!;
}

/** Resolve the provider that serves a given logical model id. */
export function getProviderForModel(modelId?: string): {
  provider: AIProvider;
  model: ModelDescriptor;
} {
  const model = resolveModel(modelId);
  return { provider: getProvider(model.provider), model };
}
