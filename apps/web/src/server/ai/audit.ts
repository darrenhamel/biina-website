import { desc } from 'drizzle-orm';
import { getDb } from '@/server/db';
import { aiAuditLog } from '@/server/db/schema';

/**
 * Append-only audit trail for admin changes to AI configuration.
 * NEVER pass secrets in previous/new values — callers diff non-secret fields only.
 */
export async function writeAudit(entry: {
  adminUserId?: string | null;
  action: string;
  targetType: string;
  targetId?: string | null;
  previousValue?: unknown;
  newValue?: unknown;
}): Promise<void> {
  await getDb().insert(aiAuditLog).values({
    adminUserId: entry.adminUserId ?? null,
    action: entry.action,
    targetType: entry.targetType,
    targetId: entry.targetId ?? null,
    previousValue: entry.previousValue ?? null,
    newValue: entry.newValue ?? null,
  });
}

export async function recentAudit(limit = 20) {
  return getDb().select().from(aiAuditLog).orderBy(desc(aiAuditLog.createdAt)).limit(limit);
}
