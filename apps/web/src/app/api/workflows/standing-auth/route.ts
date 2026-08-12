import { NextRequest } from 'next/server';
import { requireUser } from '@/server/auth/guards';
import { activeWorkspace } from '@/server/org/workspace';
import { standingAuthSchema } from '@/lib/validation';
import { handleError, ok, notFound, forbidden } from '@/lib/api';
import { resolveWorkflowAccess } from '@/server/workflows/store';
import { resolveConnectionAccess } from '@/server/connectors/connections';
import { createStandingAuthorization, listStandingAuthorizations } from '@/server/workflows/standing-auth';

/**
 * POST /api/workflows/standing-auth — create a NARROW standing authorization. This
 * IS the explicit user approval (confirm:true required). Bound to workflow + tool +
 * connection + exact destinations + limits + expiry.
 * GET — list the caller's standing authorizations.
 */
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  const auth = await requireUser();
  if ('response' in auth) return auth.response;
  try {
    const input = standingAuthSchema.parse(await req.json());
    const ws = await activeWorkspace(req, auth.user.id);
    // Caller must manage the workflow AND own/manage the connection.
    const wfAccess = await resolveWorkflowAccess(auth.user.id, input.workflowId, ws.organizationId);
    if (!wfAccess) return notFound('Workflow not found');
    if (!wfAccess.canManage) return forbidden('You cannot authorize this workflow.');
    const connAccess = await resolveConnectionAccess(auth.user.id, input.connectionId, ws.organizationId);
    if (!connAccess) return notFound('Connection not found');

    const created = await createStandingAuthorization({
      userId: auth.user.id,
      organizationId: ws.organizationId,
      workflowId: input.workflowId,
      toolId: input.toolId,
      connectionId: input.connectionId,
      allowedDestinations: input.allowedDestinations,
      maxExecutions: input.maxExecutions ?? null,
      maxExecutionsPerDay: input.maxExecutionsPerDay ?? null,
      expiresAt: new Date(Date.now() + input.expiresInDays * 24 * 60 * 60_000),
    });
    return ok({ ok: true, id: created.id, expiresAt: created.expiresAt });
  } catch (err) {
    return handleError(err, 'workflows.standing_auth.create');
  }
}

export async function GET(req: NextRequest) {
  const auth = await requireUser();
  if ('response' in auth) return auth.response;
  try {
    const rows = await listStandingAuthorizations(auth.user.id);
    return ok({ authorizations: rows.map((a) => ({ id: a.id, workflowId: a.workflowId, toolId: a.toolId, destinations: a.allowedDestinations, status: a.status, expiresAt: a.expiresAt, executionsUsed: a.executionsUsed, maxExecutions: a.maxExecutions })) });
  } catch (err) {
    return handleError(err, 'workflows.standing_auth.list');
  }
}
