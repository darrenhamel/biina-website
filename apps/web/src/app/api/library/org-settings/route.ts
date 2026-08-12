import { NextRequest } from 'next/server';
import { requireUser } from '@/server/auth/guards';
import { activeWorkspace } from '@/server/org/workspace';
import { resolveOrgContextById } from '@/server/org/organizations';
import { handleError, ok, forbidden } from '@/lib/api';
import { orgLibrarySettingsSchema } from '@/lib/validation';
import { getOrgSettings, updateOrgSettings } from '@/server/library/org';

/**
 * GET /api/library/org-settings — the active org's library curation policy.
 * PUT /api/library/org-settings — update it (org admin only).
 */
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const auth = await requireUser();
  if ('response' in auth) return auth.response;
  try {
    const ws = await activeWorkspace(req, auth.user.id);
    if (!ws.organizationId) return forbidden('Select an organization workspace.');
    const ctx = await resolveOrgContextById(auth.user.id, ws.organizationId);
    if (!ctx) return forbidden('Organization membership required.');
    const s = await getOrgSettings(ws.organizationId);
    return ok({ settings: { publicLibraryEnabled: s.publicLibraryEnabled, installPolicy: s.installPolicy, writeCapableAllowed: s.writeCapableAllowed }, canManage: ctx.role === 'OWNER' || ctx.role === 'ADMIN' });
  } catch (err) {
    return handleError(err, 'library.org_settings.get');
  }
}

export async function PUT(req: NextRequest) {
  const auth = await requireUser();
  if ('response' in auth) return auth.response;
  try {
    const ws = await activeWorkspace(req, auth.user.id);
    if (!ws.organizationId) return forbidden('Select an organization workspace.');
    const ctx = await resolveOrgContextById(auth.user.id, ws.organizationId);
    if (!ctx || (ctx.role !== 'OWNER' && ctx.role !== 'ADMIN')) return forbidden('Organization admin required.');
    const patch = orgLibrarySettingsSchema.parse(await req.json());
    const s = await updateOrgSettings(ws.organizationId, patch, auth.user.id);
    return ok({ settings: { publicLibraryEnabled: s.publicLibraryEnabled, installPolicy: s.installPolicy, writeCapableAllowed: s.writeCapableAllowed } });
  } catch (err) {
    return handleError(err, 'library.org_settings.update');
  }
}
