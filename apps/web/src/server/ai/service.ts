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
import { resolveFallbackPlan } from './fallback';
import { recordRequest, recordResult } from './metrics';

/**
 * BIINA server-side AI service — the ONLY hop between the API route and the AI
 * gateway. Cross-cutting concerns live here: request ids, system prompt,
 * timeouts, structured logging, usage + latency capture, and optional fallback.
 *
 *   route (/api/ai/chat) → aiService → @biina/ai-gateway → provider (Ollama | vLLM | …)
 *
 * The provider is invisible above this layer; switching Ollama ↔ vLLM is config.
 */

// Generous outer safety-net bound; each provider enforces its own precise timeout.
const DEFAULT_TIMEOUT_MS = 130_000;

function outerTimeoutMs(): number {
  const raw = process.env.AI_REQUEST_TIMEOUT_MS;
  const n = raw ? Number(raw) + 10_000 : DEFAULT_TIMEOUT_MS;
  return Number.isFinite(n) ? n : DEFAULT_TIMEOUT_MS;
}

export interface EffectiveMeta {
  /** Provider that actually produced the reply (may differ from primary if fallback ran). */
  provider: string;
  /** Logical model id that actually produced the reply. */
  model: string;
}

export interface AssistantStream {
  requestId: string;
  /** Primary provider/model (what headers advertise). */
  provider: string;
  model: string;
  /** Updated in place to the provider/model that actually served the reply. */
  meta: EffectiveMeta;
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

/** One gateway stream + its lifecycle (timeout timer, cleanup). */
interface OpenStream {
  stream: AsyncIterable<ChatChunk>;
  provider: string;
  model: string;
  dispose: () => void;
}

export function startAssistantReply(params: StartReplyParams): AssistantStream {
  const requestId = randomUUID();

  // Server-composed system prompt (never persisted / returned to the UI).
  const messages = withSystemPrompt(params.messages, params.promptContext);

  // Open a gateway stream for a given logical model, wiring cancellation + an
  // outer timeout. Calling this does NOT hit the network — the provider generator
  // runs lazily on first iteration.
  const open = (modelId?: string): OpenStream => {
    const controller = new AbortController();
    const onAbort = () => controller.abort();
    params.signal?.addEventListener('abort', onAbort, { once: true });
    const timer = setTimeout(() => controller.abort(), outerTimeoutMs());
    const { stream, provider, model } = streamChat({
      model: modelId,
      messages,
      requestId,
      signal: controller.signal,
    });
    return {
      stream,
      provider,
      model,
      dispose: () => {
        clearTimeout(timer);
        params.signal?.removeEventListener('abort', onAbort);
      },
    };
  };

  const primary = open(params.model);
  const meta: EffectiveMeta = { provider: primary.provider, model: primary.model };

  const startedAt = Date.now();
  recordRequest();
  logger.info('ai.chat.start', {
    requestId,
    provider: primary.provider,
    model: primary.model,
    conversationId: params.conversationId,
    userId: params.userId,
    messages: params.messages.length,
  });

  async function* wrapped(): AsyncIterable<ChatChunk> {
    let outChars = 0;
    let yielded = false;
    let firstTokenAt: number | undefined;
    let usage: UsageMeta | undefined;
    let status: 'success' | 'error' | 'cancelled' | 'failover_success' = 'success';
    let lastErrorCode: string | undefined;

    const consume = async function* (src: OpenStream): AsyncIterable<ChatChunk> {
      for await (const chunk of src.stream) {
        if (chunk.delta) {
          if (!yielded) firstTokenAt = Date.now();
          yielded = true;
          outChars += chunk.delta.length;
        }
        if (chunk.usage) usage = chunk.usage;
        yield chunk;
      }
    };

    try {
      try {
        yield* consume(primary);
      } catch (err) {
        const ge = toGatewayError(err, primary.provider);
        // Fallback only BEFORE any token streamed and never on cancellation.
        if (!yielded && ge.code !== 'cancelled') {
          const plan = resolveFallbackPlan(primary.provider);
          if (plan) {
            logger.warn('ai.chat.failover', {
              requestId,
              from: primary.provider,
              to: plan.provider,
              reason: ge.code,
            });
            const fb = open(plan.model);
            meta.provider = fb.provider;
            meta.model = fb.model;
            try {
              yield* consume(fb);
              status = 'failover_success';
              return;
            } catch (fbErr) {
              throw toGatewayError(fbErr, fb.provider);
            } finally {
              fb.dispose();
            }
          }
        }
        status = ge.code === 'cancelled' ? 'cancelled' : 'error';
        lastErrorCode = ge.code;
        logger[status === 'cancelled' ? 'info' : 'error']('ai.chat.error', {
          requestId,
          provider: meta.provider,
          model: meta.model,
          conversationId: params.conversationId,
          code: ge.code,
          error: ge.message,
        });
        throw ge;
      }
    } finally {
      primary.dispose();
      const latencyMs = Date.now() - startedAt;
      const ttftMs = firstTokenAt ? firstTokenAt - startedAt : undefined;
      recordResult({
        status,
        latencyMs,
        ttftMs,
        errorCode: lastErrorCode,
        isoTime: new Date().toISOString(),
      });
      logger.info('ai.chat.done', {
        requestId,
        provider: meta.provider,
        model: meta.model,
        conversationId: params.conversationId,
        userId: params.userId,
        status,
        ttftMs,
        latencyMs,
        outChars,
        inputTokens: usage?.inputTokens,
        outputTokens: usage?.outputTokens,
        totalTokens: usage?.totalTokens,
        generationMs: usage?.generationMs,
      });
    }
  }

  return { requestId, provider: primary.provider, model: primary.model, meta, stream: wrapped() };
}

/** Consume a stream fully into a single string (non-streaming callers). */
export async function collectStream(stream: AsyncIterable<ChatChunk>): Promise<string> {
  let out = '';
  for await (const chunk of stream) out += chunk.delta;
  return out;
}
