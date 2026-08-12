import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireUser } from '@/server/auth/guards';
import { activeWorkspace } from '@/server/org/workspace';
import { listAccessibleKnowledgeBases, createKnowledgeBase } from '@/server/rag/knowledge-bases';
import { getPlan } from '@/server/ai/plans';
import { handleError, forbidden } from '@/lib/api';

/** GET (list KBs in active workspace) / POST (create a KB). */
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const createSchema = z.object({ name: z.string().trim().min(1).max(160), description: z.string().trim().max(500).optional() });

export async function GET(req: NextRequest) {
  const auth = await requireUser();
  if ('response' in auth) return auth.response;
  try {
    const ws = await activeWorkspace(req, auth.user.id);
    const scope = ws.organizationId ? { organizationId: ws.organizationId } : { userId: auth.user.id };
    return NextResponse.json({ knowledgeBases: await listAccessibleKnowledgeBases(scope), workspace: ws.organizationId ? 'organization' : 'personal' });
  } catch (err) {
    return handleError(err, 'knowledge.list');
  }
}

export async function POST(req: NextRequest) {
  const auth = await requireUser();
  if ('response' in auth) return auth.response;
  try {
    const plan = await getPlan(auth.user.plan);
    if (!plan.filesEligible) return forbidden('Your plan does not include knowledge bases.');
    const ws = await activeWorkspace(req, auth.user.id);
    if (ws.organizationId && !plan.orgKnowledgeAccess) return forbidden('Your plan does not include organization knowledge.');
    const input = createSchema.parse(await req.json());
    const scope = ws.organizationId ? { organizationId: ws.organizationId } : { userId: auth.user.id };
    const kb = await createKnowledgeBase(auth.user, input, scope, { maxKnowledgeBases: plan.maxKnowledgeBases });
    return NextResponse.json({ ok: true, knowledgeBase: { id: kb.id, name: kb.name } }, { status: 201 });
  } catch (err) {
    return handleError(err, 'knowledge.create');
  }
}
