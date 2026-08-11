import { randomUUID } from 'node:crypto';
import {
  streamChat,
  toGatewayError,
  type ChatMessage,
  type ChatChunk,
  type UsageMeta,
} from '@biina/ai-gateway';
import { logger } from '@/lib/logger';
import { withSystemPrompt, type SystemPromptContext } from './system-prompt';

/**
 * BIINA server-side AI service — the ONLY hop between the API route and the AI
 * gateway. Cross-cutting concerns (request ids, system prompt, timeouts,
 * structured logging, usage capture) live here.
 *
 *   route (/api/ai/chat) → aiService → @biina/ai-gateway → provider (Ollama, …)
 *
 * The provider is invisible above this layer; swapping Ollama for vLLM is config.
 */

// Generous outer bound; the provider enforces its own (OLLAMA_REQUEST_TIMEOUT_MS).
const DEFAULT_TIMEOUT_MS = 125_000;

function timeoutMs(): number {
  const raw = process.env.AI_REQUEST_TIMEOUT_MS ?? process.env.OLLAMA_REQUEST_TIMEOUT_MS;
  const n = raw ? Number(raw) + 5_000 : DEFAULT_TIMEOUT_MS;
  return Number.isFinite(n) ? n : DEFAULT_TIMEOUT_MS;
}

export interface AssistantStream {
  requestId: string;
  provider: string;
  model: string;
  stream: AsyncIterable<ChatChunk>;
}

export interface StartReplyParams {
  messages: ChatMessage[];
  model?: string;
  signal?: AbortSignal;
  /** Correlation/logging context (never logs message contents). */
  conversationId?: string;
  userId?: string;
  /** Persona/feature context for the server-composed system prompt. */
  promptContext?: SystemPromptContext;
}

export function startAssistantReply(params: StartReplyParams): AssistantStream {
  const requestId = randomUUID();

  // Compose caller cancellation with a hard outer timeout.
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  params.signal?.addEventListener('abort', onAbort, { once: true });
  const timer = setTimeout(() => controller.abort(), timeoutMs());

  // Prepend the server-composed system prompt (never persisted/returned to UI).
  const messages = withSystemPrompt(params.messages, params.promptContext);

  const { stream, provider, model } = streamChat({
    model: params.model,
    messages,
    requestId,
    signal: controller.signal,
  });

  const startedAt = Date.now();
  logger.info('ai.chat.start', {
    requestId,
    provider,
    model,
    conversationId: params.conversationId,
    userId: params.userId,
    messages: params.messages.length,
  });

  async function* wrapped(): AsyncIterable<ChatChunk> {
    let outChars = 0;
    let usage: UsageMeta | undefined;
    let status: 'success' | 'error' | 'cancelled' = 'success';
    try {
      for await (const chunk of stream) {
        outChars += chunk.delta.length;
        if (chunk.usage) usage = chunk.usage;
        yield chunk;
      }
    } catch (err) {
      const ge = toGatewayError(err, provider);
      status = ge.code === 'cancelled' ? 'cancelled' : 'error';
      // Log technical detail server-side only; user-facing text is derived upstream.
      logger[status === 'cancelled' ? 'info' : 'error']('ai.chat.error', {
        requestId,
        provider,
        model,
        conversationId: params.conversationId,
        code: ge.code,
        error: ge.message,
      });
      throw ge;
    } finally {
      clearTimeout(timer);
      params.signal?.removeEventListener('abort', onAbort);
      logger.info('ai.chat.done', {
        requestId,
        provider,
        model,
        conversationId: params.conversationId,
        userId: params.userId,
        status,
        latencyMs: Date.now() - startedAt,
        outChars,
        inputTokens: usage?.inputTokens,
        outputTokens: usage?.outputTokens,
        totalTokens: usage?.totalTokens,
        generationMs: usage?.generationMs,
      });
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
