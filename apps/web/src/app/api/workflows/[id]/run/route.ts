import { NextRequest } from 'next/server';
import { z } from 'zod';
import { requireUser } from '@/server/auth/guards';
import { activeWorkspace } from '@/server/org/workspace';
import { handleError, ok, notFound, forbidden } from '@/lib/api';
import { resolveWorkflowAccess } from '@/server/workflows/store';
import { runNow } from '@/server/workflows/runs';

/** POST /api/workflows/[id]/run — run now (manual) or a dry test run. */
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const bodySchema = z.object({ dryRun: z.boolean().optional() }).strict();

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireUser();
  if ('response' in auth) return auth.response;
  try {
    const ws = await activeWorkspace(req, auth.user.id);
    const access = await resolveWorkflowAccess(auth.user.id, params.id, ws.organizationId);
    if (!access) return notFound('Workflow not found');
    if (!access.canManage) return forbidden('You cannot run this workflow.');
    const { dryRun } = bodySchema.parse(await req.json().catch(() => ({})));
    const { run, status } = await runNow(access.workflow, { dryRun: Boolean(dryRun) });
    return ok({ ok: true, runId: run.id, status, resultSummary: run.resultSummary });
  } catch (err) {
    return handleError(err, 'workflows.run');
  }
}
