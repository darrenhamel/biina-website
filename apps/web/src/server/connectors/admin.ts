import { eq, gte, sql } from 'drizzle-orm';
import { getDb } from '@/server/db';
import { connectorDefinitions, connections, connectorUsageEvents } from '@/server/db/schema';
import { writeToolsEnabled } from './registry';

/** Admin connector overview — metadata only. NEVER tokens or external content. */
export async function connectorAdminOverview() {
  const db = getDb();
  const now = new Date();
  const dayAgo = new Date(now.getTime() - 86_400_000);

  const defs = await db.select().from(connectorDefinitions).orderBy(connectorDefinitions.displayName);
  const connAgg = await db
    .select({ connectorSlug: connections.connectorSlug, status: connections.status, n: sql<number>`count(*)::int` })
    .from(connections)
    .groupBy(connections.connectorSlug, connections.status);
  const [usage] = await db
    .select({ ops: sql<number>`count(*)::int`, failures: sql<number>`count(*) filter (where ${connectorUsageEvents.success} = false)::int` })
    .from(connectorUsageEvents)
    .where(gte(connectorUsageEvents.createdAt, dayAgo));

  const byConnector = defs.map((d) => {
    const rows = connAgg.filter((c) => c.connectorSlug === d.slug);
    const active = rows.filter((r) => r.status === 'ACTIVE').reduce((s, r) => s + r.n, 0);
    const errored = rows.filter((r) => r.status === 'ERROR' || r.status === 'REAUTH_REQUIRED').reduce((s, r) => s + r.n, 0);
    return {
      slug: d.slug,
      displayName: d.displayName,
      providerType: d.providerType,
      category: d.category,
      enabled: d.enabled,
      supportsOAuth: d.supportsOAuth,
      oauthConfigured: d.providerType === 'mock' || Boolean(process.env.GOOGLE_OAUTH_CLIENT_ID),
      activeConnections: active,
      erroredConnections: errored,
      capabilities: d.capabilities,
    };
  });

  return {
    writeActionsEnabled: writeToolsEnabled(),
    encryptionConfigured: Boolean(process.env.CONNECTOR_CREDENTIAL_ENCRYPTION_KEY),
    connectors: byConnector,
    usage24h: { operations: usage?.ops ?? 0, failures: usage?.failures ?? 0 },
  };
}

/** Enable/disable a connector definition (platform admin). */
export async function setConnectorEnabled(slug: string, enabled: boolean): Promise<{ ok: boolean }> {
  await getDb().update(connectorDefinitions).set({ enabled, updatedAt: new Date() }).where(eq(connectorDefinitions.slug, slug));
  return { ok: true };
}
