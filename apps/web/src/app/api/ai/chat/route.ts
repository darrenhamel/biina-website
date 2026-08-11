import { NextRequest } from 'next/server';
import type { ChatMessage } from '@biina/ai-gateway';
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
 *   4. streams plain-text deltas to the client,
 *   5. persists the finished assistant message with provider/model metadata.
 *
 * Provider selection is invisible to the client. Phase 1 = mock provider.
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

    // Persist the user's message, then build the full history for the provider.
    await addMessage({ conversationId: convId, role: 'user', content: message });
    const history = await listMessages(convId);
    const chatMessages: ChatMessage[] = history.map((m) => ({
      role: m.role,
      content: m.content,
    }));

    const { requestId, provider, model: resolvedModel, stream } = startAssistantReply({
      messages: chatMessages,
      model,
      signal: req.signal,
    });

    const encoder = new TextEncoder();
    const finalConvId = convId;

    const body = new ReadableStream<Uint8Array>({
      async start(controller) {
        let assistantText = '';
        try {
          for await (const chunk of stream) {
            if (chunk.delta) {
              assistantText += chunk.delta;
              controller.enqueue(encoder.encode(chunk.delta));
            }
          }
        } catch (err) {
          logger.error('ai.chat.stream_error', { requestId, error: String(err) });
        } finally {
          // Persist whatever was generated (best-effort), even on early stop.
          if (assistantText.trim().length > 0) {
            try {
              await addMessage({
                conversationId: finalConvId,
                role: 'assistant',
                content: assistantText,
                provider,
                model: resolvedModel,
              });
            } catch (err) {
              logger.error('ai.chat.persist_error', { requestId, error: String(err) });
            }
          }
          controller.close();
        }
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
