import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireUser } from '@/server/auth/guards';
import { uploadDocument, listFilesForKb } from '@/server/rag/files';
import { getPlan } from '@/server/ai/plans';
import { handleError, forbidden, badRequest } from '@/lib/api';

/** GET (list documents) / POST (multipart upload → ingest). */
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const idSchema = z.string().uuid();
const MAX_UPLOAD = 20 * 1024 * 1024; // hard ceiling before plan check

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireUser();
  if ('response' in auth) return auth.response;
  try {
    const id = idSchema.parse(params.id);
    return NextResponse.json({ documents: await listFilesForKb(auth.user.id, id) });
  } catch (err) {
    return handleError(err, 'knowledge.documents.list');
  }
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireUser();
  if ('response' in auth) return auth.response;
  try {
    const id = idSchema.parse(params.id);
    const plan = await getPlan(auth.user.plan);
    if (!plan.filesEligible) return forbidden('Your plan does not include file uploads.');

    const form = await req.formData();
    const file = form.get('file');
    if (!(file instanceof File)) return badRequest('No file provided.');
    if (file.size > MAX_UPLOAD) return badRequest('File is too large.');
    const data = Buffer.from(await file.arrayBuffer());

    const record = await uploadDocument({
      user: { id: auth.user.id },
      knowledgeBaseId: id,
      input: { filename: file.name, mimeType: file.type || 'application/octet-stream', data },
      plan,
    });
    return NextResponse.json(
      { ok: true, document: { id: record.id, displayName: record.displayName, status: record.status, failureReason: record.failureReason, chunkCount: record.chunkCount, pageCount: record.pageCount } },
      { status: 201 },
    );
  } catch (err) {
    return handleError(err, 'knowledge.documents.upload');
  }
}
