import { createHash } from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';
import { getDb } from '@/server/db';
import { mediaAssets } from '@/server/db/schema';
import type { MediaAsset, Plan } from '@/server/db/schema';
import { resolveOrgContextById } from '@/server/org/organizations';
import { logSecurityEvent } from '@/server/auth/events';
import { getFileStorage } from '@/server/rag/storage';
import { detectAndValidate } from './validation';
import { MediaError } from './errors';

/**
 * MediaService — the ONLY path media enters/leaves BIINA. Uploads are validated
 * server-side (magic bytes, size, dimensions), stored as OPAQUE bytes via the
 * existing file-storage abstraction (server-only keys, never a public path), and
 * tenant-isolated. Access is re-checked on every retrieval — a known media id is
 * never sufficient. EXIF/metadata is never forwarded to a model (only the image
 * bytes a provider needs); location metadata never leaves the server.
 */

export interface MediaAccess {
  media: MediaAsset;
  canManage: boolean;
}

export async function resolveMediaAccess(userId: string, mediaId: string, activeOrganizationId: string | null): Promise<MediaAccess | null> {
  const [m] = await getDb().select().from(mediaAssets).where(eq(mediaAssets.id, mediaId)).limit(1);
  if (!m || m.status === 'DELETED') return null;
  if (!m.organizationId) {
    if (m.ownerUserId !== userId) return null; // never another user's personal media
    return { media: m, canManage: true };
  }
  if (m.organizationId !== activeOrganizationId) return null; // wrong tenant
  const ctx = await resolveOrgContextById(userId, m.organizationId);
  if (!ctx) return null; // not a member
  return { media: m, canManage: m.ownerUserId === userId };
}

async function storageUsed(scope: { userId: string; organizationId: string | null }): Promise<number> {
  const where = scope.organizationId ? and(eq(mediaAssets.organizationId, scope.organizationId), sql`${mediaAssets.status} <> 'DELETED'`) : and(eq(mediaAssets.ownerUserId, scope.userId), sql`${mediaAssets.organizationId} is null`, sql`${mediaAssets.status} <> 'DELETED'`);
  const [r] = await getDb().select({ n: sql<number>`coalesce(sum(${mediaAssets.sizeBytes}),0)::bigint` }).from(mediaAssets).where(where);
  return Number(r?.n ?? 0);
}

export async function uploadMedia(input: {
  bytes: Buffer;
  declaredMime?: string;
  userId: string;
  organizationId: string | null;
  conversationId: string | null;
  plan: Plan;
}): Promise<MediaAsset> {
  const detected = detectAndValidate(input.bytes, input.declaredMime);

  // Storage quota (media counts toward the plan's media storage limit).
  if (input.plan.mediaStorageBytesLimit != null) {
    const used = await storageUsed({ userId: input.userId, organizationId: input.organizationId });
    if (used + input.bytes.length > input.plan.mediaStorageBytesLimit) throw new MediaError('QUOTA_EXCEEDED', { scope: 'storage' });
  }

  const ext = detected.mediaType === 'IMAGE' ? detected.format : detected.format;
  const stored = await getFileStorage().put(input.bytes, { extension: ext });
  const sha256 = createHash('sha256').update(input.bytes).digest('hex');

  const [row] = await getDb()
    .insert(mediaAssets)
    .values({
      ownerUserId: input.organizationId ? null : input.userId,
      organizationId: input.organizationId,
      uploadedByUserId: input.userId,
      conversationId: input.conversationId,
      mediaType: detected.mediaType,
      mimeType: detected.mimeType,
      sizeBytes: input.bytes.length,
      storageProvider: getFileStorage().name,
      storageKey: stored.storageKey,
      sha256,
      width: detected.mediaType === 'IMAGE' ? detected.width : null,
      height: detected.mediaType === 'IMAGE' ? detected.height : null,
      status: 'READY',
    })
    .returning();

  await logSecurityEvent({ event: 'media.uploaded', userId: input.userId, actorUserId: input.userId, organizationId: input.organizationId, metadata: { mediaId: row.id, type: detected.mediaType, mime: detected.mimeType, bytes: input.bytes.length } });
  return row;
}

/** Read the bytes for a media asset (access must already be resolved). */
export async function readMediaBytes(media: MediaAsset): Promise<Buffer> {
  return getFileStorage().get(media.storageKey);
}

export async function deleteMedia(access: MediaAccess, userId: string): Promise<void> {
  await getDb().update(mediaAssets).set({ status: 'DELETED', deletedAt: new Date(), updatedAt: new Date() }).where(eq(mediaAssets.id, access.media.id));
  try {
    await getFileStorage().delete(access.media.storageKey);
  } catch {
    /* best-effort; row is already marked DELETED so it is unreachable */
  }
  await logSecurityEvent({ event: 'media.deleted', userId, actorUserId: userId, organizationId: access.media.organizationId, metadata: { mediaId: access.media.id } });
}

export async function getMedia(mediaId: string): Promise<MediaAsset | null> {
  const [m] = await getDb().select().from(mediaAssets).where(eq(mediaAssets.id, mediaId)).limit(1);
  return m ?? null;
}
