import { NextRequest, NextResponse } from 'next/server';
import { toGatewayError, type ChatMessage, type ChatChunk } from '@biina/ai-gateway';
import { getCurrentUser } from '@/server/auth/session';
import { isPlatformAdmin } from '@/server/auth/permissions';
import { resolveOrgContext } from '@/server/org/organizations';
import {
  addMessage,
  createConversation,
  getOwnedConversation,
  listMessages,
  setConversationKnowledge,
} from '@/server/conversations';
import { startAssistantReply } from '@/server/ai/service';
import type { RouteContext } from '@/server/ai/routing';
import type { SystemPromptContext } from '@/server/ai/system-prompt';
import { getPlan } from '@/server/ai/plans';
import { retrieveKnowledge } from '@/server/rag/retrieval';
import { buildRagContext, ragInstructions, type Citation, type RagMode } from '@/server/rag/context-builder';
import { retrievalConfig } from '@/server/rag/config';
import { groundWithWeb } from '@/server/web/service';
import type { WebCitation } from '@/server/web/grounding';
import { searchConnectedSources, type ConnectorCitation } from '@/server/connectors/connected-search';
import { assembleContext } from '@/server/memory/context-engine';
import { handleExplicitMemory, maybeExtractCandidates } from '@/server/memory/commands';
import { isWorkload } from '@/config/ai-routing';
import { chatRequestSchema } from '@/lib/validation';
import { WORKSPACE_COOKIE } from '@/server/org/constants';
import { unauthorized, notFound, forbidden, handleError } from '@/lib/api';
import { logger } from '@/lib/logger';

/**
 * POST /api/ai/chat — the ONE endpoint the UI uses for AI. Unchanged contract.
 *
 * Provider/model are now chosen by the DB-backed routing engine from a validated
 * routing context (never from raw privileged parameters — a normal user can only
 * hint a workload and request an APPROVED, visible BIINA model slug). The route
 * pulls the first chunk before responding so routing/provider errors return a
 * proper status instead of a broken 200 stream.
 */
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) return unauthorized();

    const { conversationId, message, model, workload, knowledgeBaseIds, ragMode, webSearch, freshness, connectionIds, temporary } = chatRequestSchema.parse(await req.json());

    // Resolve the active workspace from a cookie and VERIFY membership server-side
    // (never trust a browser-supplied org id). A suspended org blocks new AI usage.
    let orgId: string | null = null;
    let orgRole: string | null = null;
    const workspaceSlug = req.cookies.get(WORKSPACE_COOKIE)?.value;
    if (workspaceSlug && workspaceSlug !== 'personal') {
      const ctx = await resolveOrgContext(user.id, workspaceSlug);
      if (ctx) {
        if (ctx.org.status !== 'ACTIVE') return forbidden('This workspace is unavailable.');
        orgId = ctx.org.id;
        orgRole = ctx.role;
      }
      // Not a member → silently fall back to personal (no access leak).
    }

    let convId = conversationId;
    if (convId) {
      const owned = await getOwnedConversation(user.id, convId);
      if (!owned) return notFound('Conversation not found');
    } else {
      const title = message.slice(0, 60);
      const created = await createConversation(user.id, title || 'New conversation', undefined, orgId);
      convId = created.id;
    }
    const finalConvId = convId;

    await addMessage({ conversationId: finalConvId, role: 'user', content: message });
    const history = await listMessages(finalConvId);
    const chatMessages: ChatMessage[] = history.map((m) => ({ role: m.role, content: m.content }));

    // ---- Grounding: private knowledge (RAG) and/or live web ----
    // Both are opt-in, plan-gated, and kept DISTINCT. The web query is the user's
    // message ONLY — private document text is never sent to a search provider.
    let ragPrompt: SystemPromptContext['rag'];
    let webPrompt: SystemPromptContext['web'];
    let connectedPrompt: SystemPromptContext['connected'];
    const ragCitations: Array<Citation & { sourceType: 'document' }> = [];
    let webCitations: WebCitation[] = [];
    let connectorCitations: ConnectorCitation[] = [];
    const mode: RagMode = ragMode === 'strict' ? 'strict' : 'blended';
    const wantRag = Boolean(knowledgeBaseIds && knowledgeBaseIds.length > 0 && ragMode !== 'off');
    const wantConnected = Boolean(connectionIds && connectionIds.length > 0);
    // Plan is always resolved now (memory gating needs it); it's cached.
    const plan = await getPlan(user.plan);

    // Phase 13 — explicit "remember/forget" commands are handled reliably + up front
    // (personal scope only). They short-circuit with a confirmation reply.
    const explicit = await handleExplicitMemory({ message, userId: user.id, organizationId: orgId, conversationId: finalConvId, plan, temporary: Boolean(temporary) });
    if (explicit.handled && explicit.reply) {
      if (!temporary) await addMessage({ conversationId: finalConvId, role: 'assistant', content: explicit.reply });
      return new Response(explicit.reply, {
        status: 200,
        headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store, no-transform', 'X-Biina-Conversation-Id': finalConvId, 'X-Biina-Answer-Mode': 'MEMORY_COMMAND' },
      });
    }

    if (wantRag && plan?.ragEnabled) {
      const { results } = await retrieveKnowledge({
        query: message,
        userId: user.id,
        organizationId: orgId,
        knowledgeBaseIds: knowledgeBaseIds!,
        conversationId: finalConvId,
      });
      const built = buildRagContext(results, { maxContextTokens: retrievalConfig().maxContextTokens });
      ragCitations.push(...built.citations.map((c) => ({ ...c, sourceType: 'document' as const })));
      ragPrompt = { instructions: ragInstructions(mode, built.hasEvidence), contextBlock: built.contextBlock };
      await setConversationKnowledge(finalConvId, knowledgeBaseIds!, mode).catch(() => {});
    }

    if (webSearch && plan?.webSearchEnabled) {
      try {
        const web = await groundWithWeb({
          query: message, // user's question only — never private content
          userId: user.id,
          organizationId: orgId,
          plan,
          conversationId: finalConvId,
          freshness,
          signal: req.signal,
        });
        webCitations = web.citations;
        webPrompt = { instructions: web.instructions, contextBlock: web.contextBlock };
      } catch (err) {
        // Quota/entitlement errors surface to the client; other failures degrade
        // gracefully (answer without web) rather than failing the whole request.
        const ge = toGatewayError(err);
        if (ge.code === 'quota_exceeded' || ge.code === 'not_entitled') {
          return NextResponse.json({ error: ge.userMessage(), code: ge.code, ...(ge.data ? { data: ge.data } : {}) }, { status: ge.httpStatus() });
        }
        logger.warn('ai.chat.web_grounding_failed', { error: String(err) });
      }
    }

    // Connected apps (Drive/Gmail/…): explicitly selected, access re-verified,
    // private (never sent to public web). Query is the user's message only.
    if (wantConnected && plan?.connectorsEnabled) {
      try {
        const connected = await searchConnectedSources({
          query: message,
          userId: user.id,
          organizationId: orgId,
          connectionIds: connectionIds!,
          plan,
          requestId: undefined,
          signal: req.signal,
        });
        connectorCitations = connected.citations;
        if (connected.hasEvidence) connectedPrompt = { instructions: connected.instructions, contextBlock: connected.contextBlock };
      } catch (err) {
        const ge = toGatewayError(err);
        if (ge.code === 'quota_exceeded' || ge.code === 'not_entitled') {
          return NextResponse.json({ error: ge.userMessage(), code: ge.code, ...(ge.data ? { data: ge.data } : {}) }, { status: ge.httpStatus() });
        }
        logger.warn('ai.chat.connected_grounding_failed', { error: String(err) });
      }
    }
    const citations = [...ragCitations, ...webCitations, ...connectorCitations];

    // Phase 13 — the ContextEngine assembles durable memory + explicit personalization
    // (skipped entirely for temporary chat or when memory is off). Memory is background
    // context: it never overrides the current request and never authorizes actions.
    let memoryPrompt: SystemPromptContext['memory'];
    let personalizationPrompt: string | undefined;
    try {
      const assembled = await assembleContext({ userId: user.id, organizationId: orgId, persona: user.personaId, query: message, temporary: Boolean(temporary) });
      personalizationPrompt = assembled.personalization; // explicit setting; available to all
      memoryPrompt = plan.memoryEnabled ? assembled.memory : undefined; // durable memory is plan-gated
    } catch (err) {
      logger.warn('ai.chat.context_engine_failed', { error: String(err) });
    }

    // Build a validated routing context. Privileged fields (plan, isAdmin, org)
    // come from the authenticated session / verified membership, NOT the body.
    const routeContext: RouteContext = {
      userId: user.id,
      userPlan: user.plan,
      isAdmin: isPlatformAdmin(user.role),
      persona: user.personaId,
      workload: workload && isWorkload(workload) ? workload : undefined,
      requestedModelSlug: model ?? undefined,
      organizationId: orgId,
      organizationRole: orgRole,
    };

    const { requestId, meta, stream } = startAssistantReply({
      messages: chatMessages,
      routeContext,
      signal: req.signal,
      conversationId: finalConvId,
      promptContext: { personaId: user.personaId, locale: user.locale, rag: ragPrompt, web: webPrompt, connected: connectedPrompt, personalization: personalizationPrompt, memory: memoryPrompt },
    });

    // Internal answer mode (helps citations/metering/UI). CONNECTED wins the label
    // when present; otherwise web/rag as before.
    const answerMode = connectedPrompt
      ? 'CONNECTED_GROUNDED'
      : webPrompt && ragPrompt
        ? 'PRIVATE_RAG_AND_WEB'
        : webPrompt
          ? 'WEB_GROUNDED'
          : ragPrompt
            ? 'PRIVATE_RAG'
            : 'MODEL_ONLY';

    // Pull the first chunk up front: routing errors + connection/model/config
    // failures surface here (before any bytes) with a proper status + safe message.
    const iterator = stream[Symbol.asyncIterator]();
    let first: IteratorResult<ChatChunk>;
    try {
      first = await iterator.next();
    } catch (err) {
      const ge = toGatewayError(err, meta.provider || 'routing');
      if (ge.code === 'cancelled') return new NextResponse(null, { status: 499 });
      return NextResponse.json(
        // `data` carries non-secret client hints (e.g. quota resetAt), when present.
        { error: ge.userMessage(), code: ge.code, requestId, ...(ge.data ? { data: ge.data } : {}) },
        { status: ge.httpStatus() },
      );
    }

    const encoder = new TextEncoder();
    const body = new ReadableStream<Uint8Array>({
      async start(controller) {
        let assistantText = '';
        const push = (chunk?: ChatChunk) => {
          if (chunk?.delta) {
            assistantText += chunk.delta;
            controller.enqueue(encoder.encode(chunk.delta));
          }
        };
        try {
          if (!first.done) push(first.value);
          while (!first.done) {
            const next = await iterator.next();
            if (next.done) break;
            push(next.value);
          }
        } catch (err) {
          logger.warn('ai.chat.stream_interrupted', { requestId, error: String(err) });
        } finally {
          if (assistantText.trim().length > 0) {
            try {
              await addMessage({
                conversationId: finalConvId,
                role: 'assistant',
                content: assistantText,
                provider: meta.provider, // effective provider TYPE
                model: meta.model, // effective BIINA model slug
                citations: citations.length ? citations : undefined,
              });
            } catch (err) {
              logger.error('ai.chat.persist_error', { requestId, error: String(err) });
            }
          }
          // Phase 13 — best-effort inferred-memory extraction AFTER the response, from
          // the user's OWN message only (never tool/web content). ASK/AUTO mode only.
          void maybeExtractCandidates({ message, userId: user.id, organizationId: orgId, conversationId: finalConvId, plan, temporary: Boolean(temporary) });
          controller.close();
        }
      },
      cancel() {
        void iterator.return?.(undefined);
      },
    });

    return new Response(body, {
      status: 200,
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'Cache-Control': 'no-store, no-transform',
        'X-Biina-Conversation-Id': finalConvId,
        'X-Biina-Request-Id': requestId,
        // Consumer-safe: provider TYPE + BIINA logical model (never the infra model name).
        'X-Biina-Provider': meta.provider,
        'X-Biina-Model': meta.model,
        // Non-secret citation references for the client to render [n] sources.
        ...(citations.length ? { 'X-Biina-Citations': encodeURIComponent(JSON.stringify(citations)) } : {}),
        'X-Biina-Answer-Mode': answerMode,
      },
    });
  } catch (err) {
    return handleError(err, 'ai.chat');
  }
}
