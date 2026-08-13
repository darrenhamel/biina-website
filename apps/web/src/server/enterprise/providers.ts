import { and, eq } from 'drizzle-orm';
import { getDb } from '@/server/db';
import { aiProviders, aiModels } from '@/server/db/schema';
import type { AiProvider } from '@/server/db/schema';
import { logSecurityEvent } from '@/server/auth/events';
import { invalidateAiConfig } from '@/server/ai/catalog';
import { normalizeRegion } from './regions';

/**
 * Private (organization/deployment) AI providers. A private provider egresses to an
 * org-dedicated / sovereign endpoint. Credentials are NEVER stored here — only the
 * NAMES of the env/secret refs (same pattern as platform providers). Tenant isolation
 * is enforced by the router (an ORGANIZATION provider is only selectable by its owner
 * org); this module additionally scopes reads/writes to the owning org.
 */

export interface CreatePrivateProviderInput {
  organizationId: string;
  slug: string;
  displayName: string;
  type: 'openai-compatible' | 'ollama' | 'mock';
  region: string;
  baseUrlEnvRef?: string | null;
  apiKeyEnvRef?: string | null;
  privateEndpoint?: boolean;
}

export async function createPrivateProvider(input: CreatePrivateProviderInput, actorUserId: string): Promise<AiProvider> {
  const db = getDb();
  const [row] = await db
    .insert(aiProviders)
    .values({
      slug: input.slug,
      displayName: input.displayName,
      type: input.type,
      region: normalizeRegion(input.region),
      ownerType: 'ORGANIZATION',
      ownerOrganizationId: input.organizationId,
      isExternal: false,
      privateEndpoint: input.privateEndpoint ?? true,
      baseUrlEnvRef: input.baseUrlEnvRef ?? null,
      apiKeyEnvRef: input.apiKeyEnvRef ?? null,
      enabled: true,
    })
    .returning();
  invalidateAiConfig();
  await logSecurityEvent({ event: 'enterprise.provider_created', actorUserId, organizationId: input.organizationId, metadata: { slug: input.slug, region: row.region } });
  return row;
}

/** Providers owned by an org (private). Never returns another tenant's providers. */
export async function listOrgProviders(organizationId: string): Promise<AiProvider[]> {
  return getDb().select().from(aiProviders).where(and(eq(aiProviders.ownerType, 'ORGANIZATION'), eq(aiProviders.ownerOrganizationId, organizationId)));
}

/** A redacted health/availability view for enterprise AI admins. NO credentials. */
export async function orgProviderHealth(organizationId: string): Promise<Array<{ slug: string; displayName: string; region: string | null; enabled: boolean; health: string; models: number; avgLatencyMs: number | null }>> {
  const db = getDb();
  const providers = await listOrgProviders(organizationId);
  const out = [];
  for (const p of providers) {
    const models = await db.select({ id: aiModels.id, latency: aiModels.avgLatencyMs }).from(aiModels).where(eq(aiModels.providerId, p.id));
    const lat = models.map((m) => m.latency).filter((n): n is number => n != null);
    out.push({ slug: p.slug, displayName: p.displayName, region: p.region, enabled: p.enabled && !p.maintenanceMode, health: p.healthState, models: models.length, avgLatencyMs: lat.length ? Math.round(lat.reduce((a, b) => a + b, 0) / lat.length) : null });
  }
  return out;
}

/** Verify an org may use a given provider id (private-provider tenant guard). */
export async function orgOwnsProvider(organizationId: string, providerId: string): Promise<boolean> {
  const [p] = await getDb().select({ owner: aiProviders.ownerOrganizationId, ownerType: aiProviders.ownerType }).from(aiProviders).where(eq(aiProviders.id, providerId)).limit(1);
  if (!p) return false;
  if (p.ownerType !== 'ORGANIZATION') return false;
  return p.owner === organizationId;
}
