/**
 * @biina/ai-gateway — public surface.
 *
 * Server-side only. The BIINA app imports from here; it never imports a vendor
 * SDK directly and never learns which provider answered.
 */
export * from './types';
export * from './errors';
export {
  getConfig,
  getProvider,
  getProviderForModel,
  listModels,
  resolveModel,
  __resetProviderCache,
  type GatewayConfig,
} from './registry';
export { MockProvider } from './providers/mock';
export { OllamaProvider } from './providers/ollama';
export { OpenAICompatibleProvider } from './providers/openai-compatible';

import type { ChatChunk, ChatMessage, ProviderHealth, ProviderName } from './types';
import { getProvider, getProviderForModel, resolveModel } from './registry';

/**
 * Route-driven streaming: the BIINA routing engine (app layer, DB-backed) has
 * already decided the provider type + vendor model. This just executes the
 * route via the provider router. Provider CONNECTION config (base URL / key)
 * still comes from server env — secrets never live in the routing DB.
 */
export function streamChatRoute(params: {
  providerType: ProviderName;
  providerModel: string;
  messages: ChatMessage[];
  requestId: string;
  temperature?: number;
  signal?: AbortSignal;
}): { stream: AsyncIterable<ChatChunk>; provider: string } {
  const provider = getProvider(params.providerType);
  const stream = provider.chat({
    model: params.providerModel,
    messages: params.messages,
    requestId: params.requestId,
    temperature: params.temperature,
    signal: params.signal,
    stream: true,
  });
  return { stream, provider: provider.name };
}

/**
 * High-level convenience the AI service uses: resolve the provider for a logical
 * model and stream a chat completion. The provider receives the VENDOR model
 * name; callers keep the logical id for logging/persistence.
 */
export function streamChat(params: {
  model?: string;
  messages: ChatMessage[];
  requestId: string;
  temperature?: number;
  signal?: AbortSignal;
}): { stream: AsyncIterable<ChatChunk>; provider: string; model: string } {
  const { provider, model } = getProviderForModel(params.model);
  const stream = provider.chat({
    model: model.providerModel ?? model.id, // vendor name to the provider
    messages: params.messages,
    requestId: params.requestId,
    temperature: params.temperature,
    signal: params.signal,
    stream: true,
  });
  // Report the LOGICAL id upward (provider name stays generic to the app).
  return { stream, provider: provider.name, model: model.id };
}

export interface ProviderDiagnostics {
  provider: string;
  health: ProviderHealth;
  /** Configured (vendor) model for the resolved logical model. */
  configuredModel?: string;
  /** Whether the configured model was found among the provider's available models. */
  configuredModelPresent?: boolean;
  /** Model names the provider currently has available (if it can enumerate). */
  availableModels?: string[];
}

/**
 * Normalized diagnostics for the default (or named) provider — used by the
 * admin health endpoint. Never returns secrets. If the provider can enumerate
 * models, verifies the configured model actually exists.
 */
export async function providerDiagnostics(modelId?: string): Promise<ProviderDiagnostics> {
  const model = resolveModel(modelId);
  const provider = getProvider(model.provider);
  const configuredModel = model.providerModel ?? model.id;

  const health = await provider.health();

  let availableModels: string[] | undefined;
  let configuredModelPresent: boolean | undefined;
  if (health.ok && typeof provider.discoverModels === 'function') {
    availableModels = await provider.discoverModels();
    if (availableModels.length > 0) {
      configuredModelPresent = availableModels.some(
        (m) => m === configuredModel || m.split(':')[0] === configuredModel.split(':')[0],
      );
    }
  }

  return { provider: provider.name, health, configuredModel, configuredModelPresent, availableModels };
}
