import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireUser } from '@/server/auth/guards';
import { resolveKbAccess, renameKnowledgeBase, deleteKnowledgeBase } from '@/server/rag/knowledge-bases';
import { listFilesForKb } from '@/server/rag/files';
import { handleError, notFound } from '@/lib/api';

/** GET (KB + its documents) / PATCH (rename) / DELETE. */
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const idSchema = z.string().uuid();
const patchSchema = z.object({ name: z.string().trim().min(1).max(160).optional(), description: z.string().trim().max(500).nullable().optional() }).strict();

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireUser();
  if ('response' in auth) return auth.response;
  try {
    const id = idSchema.parse(params.id);
    const access = await resolveKbAccess(auth.user.id, id);
    if (!access) return notFound('Not found');
    const documents = await listFilesForKb(auth.user.id, id);
    return NextResponse.json({
      knowledgeBase: { id: access.kb.id, name: access.kb.name, description: access.kb.description, organizationId: access.kb.organizationId },
      canEdit: access.canEdit,
      documents,
    });
  } catch (err) {
    return handleError(err, 'knowledge.get');
  }
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireUser();
  if ('response' in auth) return auth.response;
  try {
    const id = idSchema.parse(params.id);
    const patch = patchSchema.parse(await req.json());
    return NextResponse.json(await renameKnowledgeBase(auth.user.id, id, patch));
  } catch (err) {
    return handleError(err, 'knowledge.rename');
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireUser();
  if ('response' in auth) return auth.response;
  try {
    const id = idSchema.parse(params.id);
    return NextResponse.json(await deleteKnowledgeBase(auth.user.id, id));
  } catch (err) {
    return handleError(err, 'knowledge.delete');
  }
}
