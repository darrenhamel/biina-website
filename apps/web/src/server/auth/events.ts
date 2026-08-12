import { desc, eq } from 'drizzle-orm';
import { getDb } from '@/server/db';
import { securityEvents } from '@/server/db/schema';

/**
 * Security-event log. Records auth/identity events. NEVER pass passwords,
 * session tokens, reset/verify tokens, or any secret in `metadata`.
 */
export type SecurityEventType =
  | 'account.created'
  | 'login.success'
  | 'login.failure'
  | 'logout'
  | 'password.changed'
  | 'password.reset.requested'
  | 'password.reset.completed'
  | 'email.verified'
  | 'session.revoked'
  | 'sessions.revoked_others'
  | 'role.changed'
  | 'plan.changed'
  | 'account.suspended'
  | 'account.reactivated'
  | 'org.created'
  | 'org.suspended'
  | 'org.reactivated'
  | 'org.member.invited'
  | 'org.invitation.revoked'
  | 'org.invitation.resent'
  | 'org.member.joined'
  | 'org.member.removed'
  | 'org.member.role_changed'
  | 'org.member.left'
  | 'org.settings.changed'
  // Phase 8 — files / knowledge / RAG.
  | 'kb.created'
  | 'kb.deleted'
  | 'file.uploaded'
  | 'file.deleted'
  | 'file.reprocessed';

export async function logSecurityEvent(entry: {
  event: SecurityEventType;
  userId?: string | null;
  actorUserId?: string | null;
  organizationId?: string | null;
  ip?: string | null;
  userAgent?: string | null;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  try {
    await getDb().insert(securityEvents).values({
      event: entry.event,
      userId: entry.userId ?? null,
      actorUserId: entry.actorUserId ?? null,
      organizationId: entry.organizationId ?? null,
      ip: entry.ip ?? null,
      userAgent: entry.userAgent?.slice(0, 400) ?? null,
      metadata: entry.metadata ?? null,
    });
  } catch {
    // Never let audit logging break the primary flow.
  }
}

export async function recentSecurityEvents(userId: string, limit = 20) {
  return getDb()
    .select()
    .from(securityEvents)
    .where(eq(securityEvents.userId, userId))
    .orderBy(desc(securityEvents.createdAt))
    .limit(limit);
}
