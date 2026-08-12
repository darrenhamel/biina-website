import { NextRequest, NextResponse } from 'next/server';
import { requireUser } from '@/server/auth/guards';
import { activeWorkspace } from '@/server/org/workspace';
import { listConnectorDefinitions } from '@/server/connectors/registry';
import { listConnectionsForScope } from '@/server/connectors/connections';
import { getPlan } from '@/server/ai/plans';
import { handleError } from '@/lib/api';

/** GET /api/connectors — available connectors + the caller's connections (no tokens). */
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const auth = await requireUser();
  if ('response' in auth) return auth.response;
  try {
    const ws = await activeWorkspace(req, auth.user.id);
    const [defs, plan, personal, org] = await Promise.all([
      listConnectorDefinitions(),
      getPlan(auth.user.plan),
      listConnectionsForScope({ userId: auth.user.id }),
      ws.organizationId ? listConnectionsForScope({ organizationId: ws.organizationId }) : Promise.resolve([]),
    ]);
    const safe = (c: (typeof personal)[number]) => ({ id: c.id, connectorSlug: c.connectorSlug, connectionType: c.connectionType, status: c.status, externalAccountEmail: c.externalAccountEmail, externalAccountName: c.externalAccountName, capabilities: c.capabilities, connectedAt: c.connectedAt, lastUsedAt: c.lastUsedAt });
    return NextResponse.json({
      connectorsEnabled: plan.connectorsEnabled,
      workspace: ws.organizationId ? 'organization' : 'personal',
      connectors: defs.map((d) => ({ slug: d.slug, displayName: d.displayName, category: d.category, providerType: d.providerType, enabled: d.enabled, supportsPersonal: d.supportsPersonal, supportsOrganization: d.supportsOrganization, capabilities: d.capabilities })),
      personalConnections: personal.map(safe),
      organizationConnections: org.map(safe),
    });
  } catch (err) {
    return handleError(err, 'connectors.list');
  }
}
