import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireUser } from '@/server/auth/guards';
import { deleteDocument } from '@/server/rag/files';
import { handleError } from '@/lib/api';

/** DELETE a document (purges storage + chunks + vectors). */
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const idSchema = z.string().uuid();

export async function DELETE(_req: NextRequest, { params }: { params: { id: string; fileId: string } }) {
  const auth = await requireUser();
  if ('response' in auth) return auth.response;
  try {
    const fileId = idSchema.parse(params.fileId);
    return NextResponse.json(await deleteDocument(auth.user.id, fileId));
  } catch (err) {
    return handleError(err, 'knowledge.documents.delete');
  }
}
