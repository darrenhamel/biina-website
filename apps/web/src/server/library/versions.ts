import { and, desc, eq } from 'drizzle-orm';
import { getDb } from '@/server/db';
import { libraryItems, libraryItemVersions } from '@/server/db/schema';
import type { LibraryItem, LibraryItemVersion } from '@/server/db/schema';
import { validateDefinition, configHash, diffVersions, type ValidationResult } from './validation';
import type { LibraryItemType, RiskLevel } from './types';

/**
 * Version lifecycle. A published version is IMMUTABLE: its configuration snapshot,
 * manifest, and hash never change. Any edit produces a NEW version (DRAFT), which
 * must be validated (and, for executables, re-reviewed) before it can be published.
 * Publishing a new version supersedes the previous one for NEW installs only —
 * existing installations keep their pinned version until explicitly updated.
 */

export interface CreateVersionInput {
  itemType: LibraryItemType;
  definition: unknown;
  changeNotes?: string | null;
  claimedReadOnly?: boolean;
  scheduled?: boolean;
  declaredCapabilities?: string[];
  supportedPersonas?: string[];
  requiredPlans?: string[];
  createdByUserId: string;
}

export interface CreateVersionResult {
  version: LibraryItemVersion;
  validation: ValidationResult;
}

/** Build a safe manifest for a version (requirements + risk + hash — no secrets). */
function buildManifest(item: LibraryItem, version: number, v: ValidationResult, hash: string) {
  return {
    itemType: item.itemType,
    version,
    risk: v.riskLevel,
    requiredTools: v.requiredTools,
    requiredConnectors: v.requiredConnectors,
    requiredCapabilities: v.requiredCapabilities,
    dataMovement: v.dataMovement,
    configHash: hash,
  } satisfies Record<string, unknown>;
}

/** Create a new DRAFT version for an item after deterministic validation. */
export async function createVersion(item: LibraryItem, input: CreateVersionInput): Promise<CreateVersionResult> {
  const validation = validateDefinition({
    itemType: input.itemType,
    definition: input.definition,
    claimedReadOnly: input.claimedReadOnly,
    scheduled: input.scheduled,
    declaredCapabilities: input.declaredCapabilities,
  });

  const db = getDb();
  const [{ maxV } = { maxV: 0 }] = await db
    .select({ maxV: libraryItemVersions.version })
    .from(libraryItemVersions)
    .where(eq(libraryItemVersions.libraryItemId, item.id))
    .orderBy(desc(libraryItemVersions.version))
    .limit(1);
  const nextVersion = (maxV ?? 0) + 1;
  const snapshot = (validation.normalized ?? {}) as Record<string, unknown>;
  const hash = configHash(input.itemType, nextVersion, snapshot);

  const [row] = await db
    .insert(libraryItemVersions)
    .values({
      libraryItemId: item.id,
      version: nextVersion,
      status: 'DRAFT',
      configurationSnapshot: snapshot,
      manifest: buildManifest(item, nextVersion, validation, hash),
      changeNotes: input.changeNotes ?? null,
      riskLevel: validation.riskLevel,
      requiredTools: validation.requiredTools,
      requiredConnectors: validation.requiredConnectors,
      requiredCapabilities: validation.requiredCapabilities,
      requiredPlans: input.requiredPlans ?? [],
      supportedPersonas: input.supportedPersonas ?? [],
      validationResult: validation as unknown as Record<string, unknown>,
      configHash: hash,
      createdByUserId: input.createdByUserId,
    })
    .returning();
  return { version: row, validation };
}

export async function getVersion(id: string): Promise<LibraryItemVersion | null> {
  const [v] = await getDb().select().from(libraryItemVersions).where(eq(libraryItemVersions.id, id)).limit(1);
  return v ?? null;
}

export async function listVersions(itemId: string): Promise<LibraryItemVersion[]> {
  return getDb().select().from(libraryItemVersions).where(eq(libraryItemVersions.libraryItemId, itemId)).orderBy(desc(libraryItemVersions.version));
}

export async function currentPublishedVersion(item: LibraryItem): Promise<LibraryItemVersion | null> {
  if (!item.currentVersionId) return null;
  return getVersion(item.currentVersionId);
}

/**
 * Publish a specific DRAFT/APPROVED version: mark it PUBLISHED (immutable), supersede
 * the prior published version, and point the item at it. Callers gate this behind
 * review for executable/risky items.
 */
export async function publishVersion(item: LibraryItem, version: LibraryItemVersion): Promise<void> {
  const db = getDb();
  const now = new Date();
  // Supersede any previously published version.
  await db.update(libraryItemVersions).set({ status: 'SUPERSEDED' }).where(and(eq(libraryItemVersions.libraryItemId, item.id), eq(libraryItemVersions.status, 'PUBLISHED')));
  await db.update(libraryItemVersions).set({ status: 'PUBLISHED', publishedAt: now }).where(eq(libraryItemVersions.id, version.id));
  await db
    .update(libraryItems)
    .set({
      currentVersionId: version.id,
      status: 'PUBLISHED',
      riskLevel: version.riskLevel,
      requiredTools: version.requiredTools,
      requiredConnectors: version.requiredConnectors,
      requiredCapabilities: version.requiredCapabilities,
      requiredPlans: version.requiredPlans,
      supportedPersonas: version.supportedPersonas,
      publishedAt: item.publishedAt ?? now,
      updatedAt: now,
    })
    .where(eq(libraryItems.id, item.id));
}

/** Compare a candidate version's surface against the item's current published one. */
export async function versionEscalation(item: LibraryItem, candidate: LibraryItemVersion) {
  const prev = await currentPublishedVersion(item);
  if (!prev) return { securitySensitive: false, newTools: [], newConnectors: [], riskIncreased: false, approvalPolicyChanged: false };
  return diffVersions(
    { requiredTools: prev.requiredTools, requiredConnectors: prev.requiredConnectors, riskLevel: prev.riskLevel as RiskLevel },
    { requiredTools: candidate.requiredTools, requiredConnectors: candidate.requiredConnectors, riskLevel: candidate.riskLevel as RiskLevel },
  );
}
