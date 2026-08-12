import { NextRequest } from 'next/server';
import { requireUser } from '@/server/auth/guards';
import { activeWorkspace } from '@/server/org/workspace';
import { editMemorySchema } from '@/lib/validation';
import { handleError, ok, notFound } from '@/lib/api';
import { resolveMemoryAccess, editMemory, deleteMemory } from '@/server/memory/store';

/** PATCH /api/memory/[id] — edit content (re-embeds). DELETE — stop future use. */
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireUser();
  if ('response' in auth) return auth.response;
  try {
    const ws = await activeWorkspace(req, auth.user.id);
    const access = await resolveMemoryAccess(auth.user.id, params.id, ws.organizationId);
    if (!access) return notFound('Memory not found');
    const { content } = editMemorySchema.parse(await req.json());
    const updated = await editMemory(access, content, auth.user.id);
    return ok({ ok: true, memory: { id: updated.id, content: updated.content, sensitivity: updated.sensitivity } });
  } catch (err) {
    return handleError(err, 'memory.edit');
  }
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireUser();
  if ('response' in auth) return auth.response;
  try {
    const ws = await activeWorkspace(req, auth.user.id);
    const access = await resolveMemoryAccess(auth.user.id, params.id, ws.organizationId);
    if (!access) return notFound('Memory not found');
    await deleteMemory(access, auth.user.id);
    return ok({ ok: true });
  } catch (err) {
    return handleError(err, 'memory.delete');
  }
}
