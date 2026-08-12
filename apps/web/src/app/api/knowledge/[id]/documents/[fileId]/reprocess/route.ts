import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireUser } from '@/server/auth/guards';
import { reprocessDocument } from '@/server/rag/files';
import { handleError } from '@/lib/api';

/** POST — retry/reprocess a document (idempotent; replaces prior chunks). */
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const idSchema = z.string().uuid();

export async function POST(_req: NextRequest, { params }: { params: { id: string; fileId: string } }) {
  const auth = await requireUser();
  if ('response' in auth) return auth.response;
  try {
    const fileId = idSchema.parse(params.fileId);
    return NextResponse.json(await reprocessDocument(auth.user.id, fileId));
  } catch (err) {
    return handleError(err, 'knowledge.documents.reprocess');
  }
}
