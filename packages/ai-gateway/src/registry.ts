import type { AIProvider, ModelDescriptor, ProviderName } from './types';
import { GatewayError } from './errors';
import { MockProvider } from './providers/mock';
import { OllamaProvider } from './providers/ollama';
import { OpenAICompatibleProvider } from './providers/openai-compatible';

/**
 * Central model registry + provider router.
 *
 * ONE place maps logical model ids -> provider + vendor model. Nothing else in
 * the app hard-codes a model name. `AI_DEFAULT_PROVIDER` / `AI_DEFAULT_MODEL`
 * (env) choose the default.
 *
 * Adding a provider later (vLLM/OpenAI/Anthropic/Gemini/DeepSeek/Qwen) = a new
 * adapter + a `case` in `instantiate` + a registry entry here. No app change.
 */

export interface GatewayConfig {
  defaultProvider: ProviderName;
  defaultModel?: string;
}

const DEFAULTS = {
  ollamaBaseUrl: 'http://localhost:11434',
  ollamaModel: 'llama3.2:3b', // small, sensible dev default; override via OLLAMA_MODEL
  requestTimeoutMs: 120_000,
};

function env(): NodeJS.ProcessEnv {
  return typeof process !== 'undefined' ? process.env : ({} as NodeJS.ProcessEnv);
}

function num(value: string | undefined, fallback: number): number {
  const n = value ? Number(value) : NaN;
  return Number.isFinite(n) ? n : fallback;
}

export function getConfig(): GatewayConfig {
  const e = env();
  return {
    defaultProvider: (e.AI_DEFAULT_PROVIDER as ProviderName) || 'mock',
    defaultModel: e.AI_DEFAULT_MODEL || undefined,
  };
}

/**
 * Build the model registry from environment. Always includes the mock model;
 * includes an Ollama entry configured from OLLAMA_* vars. The Ollama vendor
 * model name is configurable and never hard-coded in the app.
 */
export function listModels(): ModelDescriptor[] {
  const e = env();
  const ollamaModel = e.OLLAMA_MODEL || DEFAULTS.ollamaModel;

  const models: ModelDescriptor[] = [
    {
      id: 'biina-dev',
      label: 'BIINA (development)',
      provider: 'mock',
      enabled: true,
      capabilities: { chat: true, streaming: true },
      contextTokens: 8192,
    },
    {
      id: 'biina-local',
      label: 'BIINA (local)',
      provider: 'ollama',
      providerModel: ollamaModel,
      enabled: true,
      capabilities: { chat: true, streaming: true },
    },
  ];
  return models;
}

/**
 * Resolve a logical model id to its descriptor. Order of preference:
 *   1. explicit id argument, 2. AI_DEFAULT_MODEL, 3. first enabled model for the
 *   default provider, 4. first enabled model overall.
 */
export function resolveModel(modelId?: string): ModelDescriptor {
  const models = listModels().filter((m) => m.enabled !== false);
  const { defaultProvider, defaultModel } = getConfig();

  const wanted = modelId || defaultModel;
  if (wanted) {
    const hit = models.find((m) => m.id === wanted);
    if (hit) return hit;
  }
  const byProvider = models.find((m) => m.provider === defaultProvider);
  if (byProvider) return byProvider;

  if (models.length === 0) {
    throw new GatewayError('invalid_config', 'No enabled models in the registry');
  }
  return models[0];
}

// Lazily instantiated provider singletons.
const providerInstances: Partial<Record<ProviderName, AIProvider>> = {};

function instantiate(name: ProviderName): AIProvider {
  const e = env();
  const timeoutMs = num(e.OLLAMA_REQUEST_TIMEOUT_MS ?? e.AI_REQUEST_TIMEOUT_MS, DEFAULTS.requestTimeoutMs);

  switch (name) {
    case 'mock':
      return new MockProvider();
    case 'ollama':
      return new OllamaProvider({
        baseUrl: e.OLLAMA_BASE_URL || DEFAULTS.ollamaBaseUrl,
        timeoutMs,
      });
    case 'openai-compatible':
      return new OpenAICompatibleProvider({
        baseUrl: e.OPENAI_COMPATIBLE_BASE_URL,
        apiKey: e.OPENAI_COMPATIBLE_API_KEY,
        timeoutMs,
      });
    default:
      // Unknown provider: fail clearly rather than silently talking to a vendor
      // the app was not configured for.
      throw new GatewayError('invalid_config', `Unknown AI provider "${name}"`);
  }
}

export function getProvider(name?: ProviderName): AIProvider {
  const providerName = name || getConfig().defaultProvider;
  const cached = providerInstances[providerName];
  if (cached) return cached;
  const created = instantiate(providerName);
  providerInstances[providerName] = created;
  return created;
}

/** Resolve the provider that serves a given logical model id. */
export function getProviderForModel(modelId?: string): {
  provider: AIProvider;
  model: ModelDescriptor;
} {
  const model = resolveModel(modelId);
  return { provider: getProvider(model.provider), model };
}

/** Test-only: drop cached provider singletons so env changes take effect. */
export function __resetProviderCache(): void {
  for (const key of Object.keys(providerInstances)) {
    delete providerInstances[key as ProviderName];
  }
}
