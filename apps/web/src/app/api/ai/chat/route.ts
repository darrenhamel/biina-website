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

    const { conversationId, message, model, workload, knowledgeBaseIds, ragMode } = chatRequestSchema.parse(await req.json());

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

    // ---- RAG: retrieve grounded context (server-trusted scope + access) ----
    // Knowledge is used ONLY when the user selects KBs, their plan permits RAG,
    // and mode isn't 'off'. Access + tenant scope are re-verified in retrieval.
    let ragPrompt: SystemPromptContext['rag'];
    let citations: Citation[] = [];
    const mode: RagMode = ragMode === 'strict' ? 'strict' : 'blended';
    if (knowledgeBaseIds && knowledgeBaseIds.length > 0 && ragMode !== 'off') {
      const plan = await getPlan(user.plan);
      if (plan.ragEnabled) {
        const { results } = await retrieveKnowledge({
          query: message,
          userId: user.id,
          organizationId: orgId,
          knowledgeBaseIds,
          conversationId: finalConvId,
        });
        const built = buildRagContext(results, { maxContextTokens: retrievalConfig().maxContextTokens });
        citations = built.citations;
        ragPrompt = { instructions: ragInstructions(mode, built.hasEvidence), contextBlock: built.contextBlock };
        await setConversationKnowledge(finalConvId, knowledgeBaseIds, mode).catch(() => {});
      }
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
      promptContext: { personaId: user.personaId, locale: user.locale, rag: ragPrompt },
    });

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
      },
    });
  } catch (err) {
    return handleError(err, 'ai.chat');
  }
}
