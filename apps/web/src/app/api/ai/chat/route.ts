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
import { chatRequestSchema } from '@/lib/validation';
import { unauthorized, notFound, handleError } from '@/lib/api';
import { logger } from '@/lib/logger';

/**
 * POST /api/ai/chat — the ONE endpoint the UI uses for AI.
 *
 * The browser never talks to a model vendor. This route:
 *   1. authenticates + validates,
 *   2. persists the user message (creating a conversation if needed),
 *   3. asks the AI service (→ gateway → provider) for a streamed reply,
 *   4. pulls the first chunk so provider errors return a clean status BEFORE the
 *      stream starts (once bytes flow, the status is already 200),
 *   5. streams plain-text deltas to the client,
 *   6. persists the finished assistant message with provider/model metadata.
 *
 * Provider selection is invisible to the client.
 */
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) return unauthorized();

    const { conversationId, message, model } = chatRequestSchema.parse(await req.json());

    // Resolve or create the conversation (ownership enforced).
    let convId = conversationId;
    if (convId) {
      const owned = await getOwnedConversation(user.id, convId);
      if (!owned) return notFound('Conversation not found');
    } else {
      const title = message.slice(0, 60);
      const created = await createConversation(user.id, title || 'New conversation', model);
      convId = created.id;
    }
    const finalConvId = convId;

    // Persist the user's message, then build the full history for the provider.
    await addMessage({ conversationId: finalConvId, role: 'user', content: message });
    const history = await listMessages(finalConvId);
    const chatMessages: ChatMessage[] = history.map((m) => ({ role: m.role, content: m.content }));

    const { requestId, provider, model: resolvedModel, meta, stream } = startAssistantReply({
      messages: chatMessages,
      model,
      signal: req.signal,
      conversationId: finalConvId,
      userId: user.id,
      promptContext: { personaId: user.personaId, locale: user.locale },
    });

    // Pull the first chunk up front: connection / model / config errors surface
    // here (before any bytes) so we can return a proper status + safe message.
    const iterator = stream[Symbol.asyncIterator]();
    let first: IteratorResult<ChatChunk>;
    try {
      first = await iterator.next();
    } catch (err) {
      const ge = toGatewayError(err, provider);
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
          // Mid-stream failure (status already 200). Logged in the service too.
          logger.warn('ai.chat.stream_interrupted', { requestId, error: String(err) });
        } finally {
          if (assistantText.trim().length > 0) {
            try {
              await addMessage({
                conversationId: finalConvId,
                role: 'assistant',
                content: assistantText,
                // Effective provider/model (accurate even if fallback engaged).
                provider: meta.provider,
                model: meta.model,
              });
            } catch (err) {
              logger.error('ai.chat.persist_error', { requestId, error: String(err) });
            }
          }
          controller.close();
        }
      },
      cancel() {
        // Client disconnected / stop pressed — propagate cancellation to the provider.
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
        'X-Biina-Provider': provider,
        'X-Biina-Model': resolvedModel,
      },
    });
  } catch (err) {
    return handleError(err, 'ai.chat');
  }
}
