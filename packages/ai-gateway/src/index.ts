/**
 * @biina/ai-gateway — public surface.
 *
 * Server-side only. The BIINA app imports from here; it never imports a vendor
 * SDK directly and never learns which provider answered.
 */
export * from './types';
export {
  getConfig,
  getProvider,
  getProviderForModel,
  listModels,
  resolveModel,
  type GatewayConfig,
} from './registry';
export { MockProvider } from './providers/mock';

import type { ChatChunk, ChatMessage } from './types';
import { getProviderForModel } from './registry';

/**
 * High-level convenience the API route uses: resolve the provider for a model
 * and stream a chat completion. Returns the async iterable of chunks plus the
 * resolved provider/model metadata (for logging + usage records).
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
    model: model.id,
    messages: params.messages,
    requestId: params.requestId,
    temperature: params.temperature,
    signal: params.signal,
    stream: true,
  });
  return { stream, provider: provider.name, model: model.id };
}
