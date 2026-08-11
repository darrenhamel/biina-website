import { NextRequest } from 'next/server';
import { getCurrentUser } from '@/server/auth/session';
import { getOwnedConversation, listMessages } from '@/server/conversations';
import { ok, unauthorized, notFound, handleError } from '@/lib/api';

export const dynamic = 'force-dynamic';

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const user = await getCurrentUser();
    if (!user) return unauthorized();
    const conversation = await getOwnedConversation(user.id, params.id);
    if (!conversation) return notFound('Conversation not found');
    return ok({ messages: await listMessages(conversation.id) });
  } catch (err) {
    return handleError(err, 'conversations.messages');
  }
}
