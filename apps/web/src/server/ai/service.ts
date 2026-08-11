import { randomUUID } from 'node:crypto';
import { streamChat, type ChatMessage, type ChatChunk } from '@biina/ai-gateway';
import { logger } from '@/lib/logger';

/**
 * BIINA server-side AI service — the ONLY hop between the API route and the AI
 * gateway. It exists so the route handler never imports a provider directly and
 * so cross-cutting concerns (request ids, logging, timeouts) live in one place.
 *
 *   route (/api/ai/chat) → aiService → @biina/ai-gateway → provider
 *
 * Phase 1 resolves to the mock provider. Phase 2 wires Ollama / vLLM behind the
 * same call with no change here or above.
 */

const DEFAULT_TIMEOUT_MS = 60_000;

export interface AssistantStream {
  requestId: string;
  provider: string;
  model: string;
  stream: AsyncIterable<ChatChunk>;
}

export function startAssistantReply(params: {
  messages: ChatMessage[];
  model?: string;
  signal?: AbortSignal;
  timeoutMs?: number;
}): AssistantStream {
  const requestId = randomUUID();
  const timeout = params.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  // Compose caller cancellation with a hard timeout.
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  params.signal?.addEventListener('abort', onAbort, { once: true });
  const timer = setTimeout(() => controller.abort(), timeout);

  const { stream, provider, model } = streamChat({
    model: params.model,
    messages: params.messages,
    requestId,
    signal: controller.signal,
  });

  logger.info('ai.chat.start', { requestId, provider, model, messages: params.messages.length });

  async function* wrapped(): AsyncIterable<ChatChunk> {
    let outChars = 0;
    try {
      for await (const chunk of stream) {
        outChars += chunk.delta.length;
        if (chunk.done) {
          logger.info('ai.chat.done', { requestId, provider, model, outChars, usage: chunk.usage });
        }
        yield chunk;
      }
    } catch (err) {
      logger.error('ai.chat.error', { requestId, provider, model, error: String(err) });
      throw err;
    } finally {
      clearTimeout(timer);
      params.signal?.removeEventListener('abort', onAbort);
    }
  }

  return { requestId, provider, model, stream: wrapped() };
}

/** Consume a stream fully into a single string (non-streaming callers). */
export async function collectStream(stream: AsyncIterable<ChatChunk>): Promise<string> {
  let out = '';
  for await (const chunk of stream) out += chunk.delta;
  return out;
}
