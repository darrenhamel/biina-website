import { getCurrentUser } from '@/server/auth/session';
import { createConversation, listConversations } from '@/server/conversations';
import { ok, unauthorized, handleError } from '@/lib/api';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const user = await getCurrentUser();
    if (!user) return unauthorized();
    return ok({ conversations: await listConversations(user.id) });
  } catch (err) {
    return handleError(err, 'conversations.list');
  }
}

export async function POST() {
  try {
    const user = await getCurrentUser();
    if (!user) return unauthorized();
    const conversation = await createConversation(user.id, 'New conversation');
    return ok({ conversation }, { status: 201 });
  } catch (err) {
    return handleError(err, 'conversations.create');
  }
}
