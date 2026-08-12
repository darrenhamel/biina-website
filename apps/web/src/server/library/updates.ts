import { eq } from 'drizzle-orm';
import { getDb } from '@/server/db';
import { agentDefinitions, libraryInstallations, libraryItems, workflows } from '@/server/db/schema';
import type { LibraryInstallation, LibraryItem } from '@/server/db/schema';
import { AppError } from '@/lib/errors';
import { logSecurityEvent } from '@/server/auth/events';
import { createItem } from './items';
import { createVersion, currentPublishedVersion, getVersion, publishVersion } from './versions';
import { diffVersions } from './validation';
import { getExperienceProfile } from '@/config/experience-profiles';
import { type LibraryItemType, type RiskLevel } from './types';
import type { LibraryViewer } from './access';
import { getInstallation } from './installations';

/**
 * Version UPDATE + FORK.
 *
 * An installed executable is NEVER silently upgraded to a version that adds a tool,
 * adds a connector, raises the risk class, or changes the approval policy. Such a
 * "security-sensitive" update requires an explicit `confirm` from the installer (and
 * the platform's re-review already gated the version's publication). Content-only
 * items may be refreshed freely. Forking creates a PRIVATE copy that no longer
 * inherits future upstream changes.
 */

export interface UpdatePreview {
  currentVersionId: string;
  targetVersionId: string;
  securitySensitive: boolean;
  newTools: string[];
  newConnectors: string[];
  riskIncreased: boolean;
  approvalPolicyChanged: boolean;
}

export async function previewUpdate(viewer: LibraryViewer, installationId: string): Promise<UpdatePreview | null> {
  const inst = await getInstallation(viewer, installationId);
  if (!inst) throw new AppError(404, 'Installation not found.', 'not_found');
  const [item] = await getDb().select().from(libraryItems).where(eq(libraryItems.id, inst.libraryItemId)).limit(1);
  if (!item) return null;
  const target = await currentPublishedVersion(item);
  const currentV = await getVersion(inst.versionId);
  if (!target || !currentV || target.id === inst.versionId) return null;

  const diff = diffVersions(
    { requiredTools: currentV.requiredTools, requiredConnectors: currentV.requiredConnectors, riskLevel: currentV.riskLevel as RiskLevel },
    { requiredTools: target.requiredTools, requiredConnectors: target.requiredConnectors, riskLevel: target.riskLevel as RiskLevel },
  );
  return {
    currentVersionId: inst.versionId,
    targetVersionId: target.id,
    securitySensitive: diff.securitySensitive,
    newTools: diff.newTools,
    newConnectors: diff.newConnectors,
    riskIncreased: diff.riskIncreased,
    approvalPolicyChanged: diff.approvalPolicyChanged,
  };
}

/** Apply the item's current published version to an installation. */
export async function updateInstallation(viewer: LibraryViewer, installationId: string, confirm: boolean): Promise<{ ok: true; applied: boolean }> {
  const inst = await getInstallation(viewer, installationId);
  if (!inst) throw new AppError(404, 'Installation not found.', 'not_found');
  if (inst.pinnedVersion) throw new AppError(409, 'This installation is pinned to its current version.', 'pinned');
  const preview = await previewUpdate(viewer, installationId);
  if (!preview) return { ok: true, applied: false };

  // A security-sensitive update (new tool/connector/risk/approval) needs explicit confirm.
  // Existing permissions do NOT carry over automatically to added capabilities.
  if (preview.securitySensitive && !confirm) {
    await logSecurityEvent({ event: 'library.update_blocked', userId: viewer.userId, organizationId: viewer.activeOrganizationId, metadata: { installationId, reason: 'requires_confirmation', newTools: preview.newTools, newConnectors: preview.newConnectors } });
    throw new AppError(409, 'This update changes the item’s capabilities and requires explicit review.', 'update_requires_review', { preview: preview as unknown as Record<string, unknown> });
  }

  const db = getDb();
  const target = await getVersion(preview.targetVersionId);
  if (!target) return { ok: true, applied: false };
  const snapshot = target.configurationSnapshot as Record<string, unknown>;

  // Re-point the local definition to the new snapshot. A WORKFLOW that gains a new
  // capability drops back to DRAFT so the user must reconfigure/re-activate it.
  if (inst.installedDefinitionType === 'AGENT' && inst.installedDefinitionId) {
    await db
      .update(agentDefinitions)
      .set({
        instructions: String(snapshot.instructions ?? ''),
        allowedTools: (snapshot.allowedTools as string[]) ?? [],
        allowedConnectors: (snapshot.allowedConnectors as string[]) ?? [],
        updatedAt: new Date(),
      })
      .where(eq(agentDefinitions.id, inst.installedDefinitionId));
  } else if (inst.installedDefinitionType === 'WORKFLOW' && inst.installedDefinitionId) {
    await db
      .update(workflows)
      .set({ goal: String(snapshot.goal ?? ''), status: preview.securitySensitive ? 'DRAFT' : undefined, updatedAt: new Date() } as never)
      .where(eq(workflows.id, inst.installedDefinitionId));
  } else {
    await db.update(libraryInstallations).set({ localConfig: snapshot }).where(eq(libraryInstallations.id, inst.id));
  }

  await db.update(libraryInstallations).set({ versionId: target.id, updatedAt: new Date() }).where(eq(libraryInstallations.id, inst.id));
  await logSecurityEvent({ event: 'library.updated_install', userId: viewer.userId, organizationId: viewer.activeOrganizationId, metadata: { installationId, versionId: target.id, securitySensitive: preview.securitySensitive } });
  return { ok: true, applied: true };
}

/**
 * Fork a source item into a PRIVATE copy the user/org owns and can customize. The
 * fork records provenance and no longer inherits upstream changes. Safety-critical
 * limits still apply on the fork (it is re-validated on publish/use).
 */
export async function forkItem(viewer: LibraryViewer, source: LibraryItem): Promise<LibraryItem> {
  const version = await currentPublishedVersion(source);
  if (!version) throw new AppError(409, 'Only a published item can be forked.', 'no_version');

  const publisherType = viewer.activeOrganizationId ? 'ORGANIZATION' : 'USER';
  const fork = await createItem({
    itemType: source.itemType as LibraryItemType,
    title: `${source.title} (copy)`,
    titleAr: source.titleAr ? `${source.titleAr} (نسخة)` : null,
    shortDescription: source.shortDescription,
    longDescription: source.longDescription,
    publisherType,
    publisherUserId: viewer.activeOrganizationId ? null : viewer.userId,
    publisherOrganizationId: viewer.activeOrganizationId,
    visibility: 'PRIVATE',
    categories: source.categories,
    tags: source.tags,
    supportedPersonas: source.supportedPersonas,
    createdByUserId: viewer.userId,
  });

  // Copy the current configuration into the fork's first version (re-validated).
  await createVersion(fork, {
    itemType: source.itemType as LibraryItemType,
    definition: version.configurationSnapshot,
    changeNotes: `Forked from ${source.slug} v${version.version}`,
    scheduled: false,
    supportedPersonas: source.supportedPersonas,
    createdByUserId: viewer.userId,
  });

  await getDb()
    .update(libraryItems)
    .set({ verified: false, monetizationStatus: 'FREE', updatedAt: new Date() })
    .where(eq(libraryItems.id, fork.id));

  await logSecurityEvent({ event: 'library.forked', userId: viewer.userId, organizationId: viewer.activeOrganizationId, metadata: { sourceItemId: source.id, forkItemId: fork.id, derivedFromVersionId: version.id } });
  void getExperienceProfile;
  void publishVersion;
  return fork;
}
