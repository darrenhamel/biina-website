import { randomUUID } from 'node:crypto';
import {
  streamChatRoute,
  toGatewayError,
  type ChatMessage,
  type ChatChunk,
  type UsageMeta,
} from '@biina/ai-gateway';
import { logger } from '@/lib/logger';
import { withSystemPrompt, type SystemPromptContext } from './system-prompt';
import { recordRequest, recordResult } from './metrics';
import { loadAiConfig, modelBySlug } from './catalog';
import { selectRoute, selectFallback, type RouteContext, type RouteDecision } from './routing';
import { preflight, meteringEnabled, type PreflightResult } from './preflight';
import { estimateCost } from './cost';
import { writeUsageEvent } from './ledger';

/**
 * BIINA server-side AI service — the ONLY hop between the API route and the AI
 * gateway. It now consults the DB-backed ROUTING ENGINE to decide which BIINA
 * model / provider serves each request, then executes that route via the
 * gateway's provider router:
 *
 *   route (/api/ai/chat) → aiService → routing engine (DB) → @biina/ai-gateway → provider
 *
 * Provider connection secrets stay in ENV; the routing DB holds only non-secret
 * operational config. The provider remains invisible to the UI.
 */

const DEFAULT_TIMEOUT_MS = 130_000;
function outerTimeoutMs(): number {
  const raw = process.env.AI_REQUEST_TIMEOUT_MS;
  const n = raw ? Number(raw) + 10_000 : DEFAULT_TIMEOUT_MS;
  return Number.isFinite(n) ? n : DEFAULT_TIMEOUT_MS;
}

export interface EffectiveMeta {
  provider: string; // provider TYPE (e.g. "openai-compatible")
  model: string; // BIINA logical slug (e.g. "biina-general-v1")
  providerModel: string; // vendor model (admin/debug only)
  reason: string;
  fallbackUsed: boolean;
}

export interface AssistantStream {
  requestId: string;
  meta: EffectiveMeta;
  stream: AsyncIterable<ChatChunk>;
}

export interface StartReplyParams {
  messages: ChatMessage[];
  routeContext: RouteContext;
  signal?: AbortSignal;
  conversationId?: string;
  promptContext?: SystemPromptContext;
}

interface OpenStream {
  stream: AsyncIterable<ChatChunk>;
  dispose: () => void;
}

export function startAssistantReply(params: StartReplyParams): AssistantStream {
  const requestId = randomUUID();
  const meta: EffectiveMeta = { provider: '', model: '', providerModel: '', reason: '', fallbackUsed: false };
  const messages = withSystemPrompt(params.messages, params.promptContext);

  const openRoute = (decision: RouteDecision, maxOutputTokens?: number): OpenStream => {
    const controller = new AbortController();
    const onAbort = () => controller.abort();
    params.signal?.addEventListener('abort', onAbort, { once: true });
    const timer = setTimeout(() => controller.abort(), outerTimeoutMs());
    const { stream } = streamChatRoute({
      providerType: decision.providerType,
      providerModel: decision.providerModel,
      messages,
      requestId,
      maxOutputTokens,
      signal: controller.signal,
    });
    return {
      stream,
      dispose: () => {
        clearTimeout(timer);
        params.signal?.removeEventListener('abort', onAbort);
      },
    };
  };

  const setMeta = (d: RouteDecision) => {
    meta.provider = d.providerType;
    meta.model = d.biinaModelSlug;
    meta.providerModel = d.providerModel;
    meta.reason = d.reason;
    meta.fallbackUsed = d.fallbackUsed;
  };

  async function* wrapped(): AsyncIterable<ChatChunk> {
    recordRequest();
    const startedAt = Date.now();
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

    // Resolve the route (DB snapshot). Routing errors surface here → the route
    // handler maps them to a clean status (never a broken 200 stream).
    const snap = await loadAiConfig();
    let decision: RouteDecision;
    try {
      decision = selectRoute(params.routeContext, snap);
    } catch (err) {
      const ge = toGatewayError(err, 'routing');
      lastErrorCode = ge.code;
      status = 'error';
      logger.error('ai.routing.error', { requestId, code: ge.code, error: ge.message });
      recordResult({ status, latencyMs: Date.now() - startedAt, errorCode: ge.code, isoTime: new Date().toISOString() });
      throw ge;
    }

    // Proactive health-based fallback: if the primary provider is known-unhealthy
    // and fallback is enabled, switch before spending a failed call.
    if (snap.settings.fallbackEnabled && decision.provider.healthState === 'error') {
      const fb = selectFallback(snap, decision, params.routeContext);
      if (fb) {
        logger.warn('ai.routing.failover', { requestId, from: decision.providerType, to: fb.providerType, reason: 'primary_unhealthy' });
        decision = fb;
      }
    }

    setMeta(decision);
    logger.info('ai.routing.decision', {
      requestId,
      conversationId: params.conversationId,
      userId: params.routeContext.userId,
      biinaModel: decision.biinaModelSlug,
      provider: decision.providerType,
      providerModel: decision.providerModel,
      persona: params.routeContext.persona ?? undefined,
      workload: params.routeContext.workload ?? undefined,
      plan: params.routeContext.userPlan,
      routingReason: decision.reason,
      fallbackUsed: decision.fallbackUsed,
    });

    // Pre-generation checks (entitlement → context → budget → quota → concurrency).
    // A rejection throws a typed GatewayError here — BEFORE any provider call — so
    // no usage is metered for requests that never ran.
    let pf: PreflightResult;
    try {
      pf = await preflight({
        userId: params.routeContext.userId ?? 'anonymous',
        isAdmin: Boolean(params.routeContext.isAdmin),
        planSlug: params.routeContext.userPlan ?? 'FREE',
        persona: params.routeContext.persona,
        workload: params.routeContext.workload,
        biinaModelSlug: decision.biinaModelSlug,
        snapshot: snap,
        messages: params.messages,
        now: new Date(),
      });
    } catch (err) {
      const ge = toGatewayError(err, 'preflight');
      lastErrorCode = ge.code;
      status = 'error';
      logger.info('ai.preflight.reject', { requestId, code: ge.code, userId: params.routeContext.userId });
      recordResult({ status, latencyMs: Date.now() - startedAt, errorCode: ge.code, isoTime: new Date().toISOString() });
      throw ge;
    }

    // Attempt #1 = the model we first try; attempt #2 set if runtime fallback fires.
    const attempt1 = { providerType: decision.providerType, providerModelId: decision.providerModel };
    let attempt2: { providerType: string; providerModelId: string } | undefined;

    let primary = openRoute(decision, pf.maxOutputTokens);
    try {
      try {
        yield* consume(primary);
      } catch (err) {
        const ge = toGatewayError(err, decision.providerType);
        if (!yielded && ge.code !== 'cancelled') {
          const fb = selectFallback(snap, decision, params.routeContext);
          if (fb) {
            logger.warn('ai.routing.failover', { requestId, from: decision.providerType, to: fb.providerType, reason: ge.code });
            setMeta(fb);
            attempt2 = { providerType: fb.providerType, providerModelId: fb.providerModel };
            primary.dispose();
            const fbStream = openRoute(fb, pf.maxOutputTokens);
            try {
              yield* consume(fbStream);
              status = 'failover_success';
              return;
            } catch (fbErr) {
              const fbe = toGatewayError(fbErr, fb.providerType);
              lastErrorCode = fbe.code;
              status = 'error';
              throw fbe;
            } finally {
              fbStream.dispose();
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
      pf.release(); // free the concurrency slot
      const latencyMs = Date.now() - startedAt;
      const ttftMs = firstTokenAt ? firstTokenAt - startedAt : undefined;
      recordResult({ status, latencyMs, ttftMs, errorCode: lastErrorCode, isoTime: new Date().toISOString() });
      logger.info('ai.chat.done', {
        requestId,
        provider: meta.provider,
        model: meta.model,
        conversationId: params.conversationId,
        userId: params.routeContext.userId,
        status,
        fallbackUsed: meta.fallbackUsed,
        ttftMs,
        latencyMs,
        outChars,
        inputTokens: usage?.inputTokens,
        outputTokens: usage?.outputTokens,
        totalTokens: usage?.totalTokens,
        generationMs: usage?.generationMs,
      });

      // Post-generation accounting — write the usage ledger (idempotent). Runs on
      // success, error, cancellation, and fallback. Best-effort; never throws.
      if (meteringEnabled()) {
        try {
          await writeLedgerEvent({
            requestId,
            params,
            snap,
            meta,
            planSlug: pf.planSlug,
            usage,
            ttftMs,
            latencyMs,
            status,
            failureCategory: lastErrorCode,
            attempt1,
            attempt2,
          });
        } catch (err) {
          logger.error('ai.usage.persist_error', { requestId, error: String(err) });
        }
      }
    }
  }

  return { requestId, meta, stream: wrapped() };
}

/** Consume a stream fully into a single string (non-streaming callers). */
export async function collectStream(stream: AsyncIterable<ChatChunk>): Promise<string> {
  let out = '';
  for await (const chunk of stream) out += chunk.delta;
  return out;
}

/** Map the service's internal status to the ledger's usage status enum. */
function toUsageStatus(
  status: 'success' | 'error' | 'cancelled' | 'failover_success',
  failureCategory?: string,
): 'success' | 'error' | 'cancelled' | 'timeout' {
  if (status === 'success' || status === 'failover_success') return 'success';
  if (status === 'cancelled') return 'cancelled';
  return failureCategory === 'timeout' ? 'timeout' : 'error';
}

async function writeLedgerEvent(args: {
  requestId: string;
  params: StartReplyParams;
  snap: Awaited<ReturnType<typeof loadAiConfig>>;
  meta: EffectiveMeta;
  planSlug: string;
  usage?: UsageMeta;
  ttftMs?: number;
  latencyMs: number;
  status: 'success' | 'error' | 'cancelled' | 'failover_success';
  failureCategory?: string;
  attempt1: { providerType: string; providerModelId: string };
  attempt2?: { providerType: string; providerModelId: string };
}): Promise<void> {
  const { snap, meta, usage } = args;
  const usageStatus = toUsageStatus(args.status, args.failureCategory);
  // Provider failures do NOT count against user quota; success/cancel do.
  const countedAgainstQuota = usageStatus === 'success' || usageStatus === 'cancelled';

  const model = modelBySlug(snap, meta.model);
  const cost = estimateCost(model ?? undefined, {
    inputTokens: usage?.inputTokens ?? null,
    outputTokens: usage?.outputTokens ?? null,
  });

  const attempts = [
    {
      providerType: args.attempt1.providerType,
      providerModelId: args.attempt1.providerModelId,
      status: meta.fallbackUsed ? 'error' : usageStatus,
      ...(meta.fallbackUsed ? {} : { inputTokens: usage?.inputTokens, outputTokens: usage?.outputTokens, estimatedCost: cost.totalCost ?? undefined }),
    },
  ];
  if (args.attempt2) {
    attempts.push({
      providerType: args.attempt2.providerType,
      providerModelId: args.attempt2.providerModelId,
      status: usageStatus,
      inputTokens: usage?.inputTokens,
      outputTokens: usage?.outputTokens,
      estimatedCost: cost.totalCost ?? undefined,
    });
  }

  await writeUsageEvent({
    requestId: args.requestId,
    userId: args.params.routeContext.userId ?? null,
    organizationId: args.params.routeContext.organizationId ?? null,
    conversationId: args.params.conversationId ?? null,
    biinaModelSlug: meta.model || null,
    providerType: meta.provider || null,
    providerModelId: meta.providerModel || null,
    persona: args.params.routeContext.persona ?? null,
    workload: args.params.routeContext.workload ?? null,
    plan: args.planSlug,
    inputTokens: usage?.inputTokens ?? null,
    outputTokens: usage?.outputTokens ?? null,
    totalTokens: usage?.totalTokens ?? null,
    estimatedInputCost: cost.inputCost,
    estimatedOutputCost: cost.outputCost,
    estimatedTotalCost: cost.totalCost,
    currency: cost.currency,
    timeToFirstTokenMs: args.ttftMs ?? null,
    generationMs: usage?.generationMs ?? null,
    totalLatencyMs: args.latencyMs,
    fallbackUsed: meta.fallbackUsed,
    fallbackProviderType: meta.fallbackUsed ? meta.provider : null,
    fallbackModelSlug: meta.fallbackUsed ? meta.model : null,
    providerAttempts: attempts,
    status: usageStatus,
    failureCategory: args.failureCategory ?? null,
    countedAgainstQuota,
    completedAt: new Date(),
  });
}
