import { NextRequest, NextResponse } from 'next/server';
import { toGatewayError, type ChatMessage, type ChatChunk } from '@biina/ai-gateway';
import { getCurrentUser } from '@/server/auth/session';
import {
  addMessage,
  createConversation,
  getOwnedConversation,
  listMessages,
} from '@/server/conversations';
import { startAssistantReply } from '@/server/ai/service';
import type { RouteContext } from '@/server/ai/routing';
import { isWorkload } from '@/config/ai-routing';
import { chatRequestSchema } from '@/lib/validation';
import { unauthorized, notFound, handleError } from '@/lib/api';
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

    const { conversationId, message, model, workload } = chatRequestSchema.parse(await req.json());

    let convId = conversationId;
    if (convId) {
      const owned = await getOwnedConversation(user.id, convId);
      if (!owned) return notFound('Conversation not found');
    } else {
      const title = message.slice(0, 60);
      const created = await createConversation(user.id, title || 'New conversation');
      convId = created.id;
    }
    const finalConvId = convId;

    await addMessage({ conversationId: finalConvId, role: 'user', content: message });
    const history = await listMessages(finalConvId);
    const chatMessages: ChatMessage[] = history.map((m) => ({ role: m.role, content: m.content }));

    // Build a validated routing context. Privileged fields (plan, isAdmin) come
    // from the authenticated session, NOT from the request body.
    const routeContext: RouteContext = {
      userId: user.id,
      userPlan: user.plan,
      isAdmin: user.role === 'ADMIN',
      persona: user.personaId,
      workload: workload && isWorkload(workload) ? workload : undefined,
      requestedModelSlug: model ?? undefined,
    };

    const { requestId, meta, stream } = startAssistantReply({
      messages: chatMessages,
      routeContext,
      signal: req.signal,
      conversationId: finalConvId,
      promptContext: { personaId: user.personaId, locale: user.locale },
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
        { error: ge.userMessage(), code: ge.code, requestId },
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
      },
    });
  } catch (err) {
    return handleError(err, 'ai.chat');
  }
}
