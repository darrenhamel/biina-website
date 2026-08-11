import { NextRequest } from 'next/server';
import { getCurrentUser } from '@/server/auth/session';
import { deleteConversation, renameConversation } from '@/server/conversations';
import { renameConversationSchema } from '@/lib/validation';
import { ok, unauthorized, notFound, handleError } from '@/lib/api';

export const dynamic = 'force-dynamic';

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const user = await getCurrentUser();
    if (!user) return unauthorized();
    const { title } = renameConversationSchema.parse(await req.json());
    const updated = await renameConversation(user.id, params.id, title);
    if (!updated) return notFound('Conversation not found');
    return ok({ conversation: updated });
  } catch (err) {
    return handleError(err, 'conversations.rename');
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const user = await getCurrentUser();
    if (!user) return unauthorized();
    const deleted = await deleteConversation(user.id, params.id);
    if (!deleted) return notFound('Conversation not found');
    return ok({ ok: true });
  } catch (err) {
    return handleError(err, 'conversations.delete');
  }
}
