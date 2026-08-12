import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/server/auth/guards';
import { ragOverview, adminDocumentSearch } from '@/server/rag/admin';
import { handleError } from '@/lib/api';

/**
 * GET /api/admin/rag — RAG operational overview + metadata-only document search
 * (ADMIN). Never returns private document content.
 */
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const auth = await requireAdmin();
  if ('response' in auth) return auth.response;
  try {
    const q = req.nextUrl.searchParams.get('q') ?? undefined;
    const [overview, documents] = await Promise.all([ragOverview(), adminDocumentSearch(q)]);
    return NextResponse.json({ ...overview, documents });
  } catch (err) {
    return handleError(err, 'admin.rag.overview');
  }
}
