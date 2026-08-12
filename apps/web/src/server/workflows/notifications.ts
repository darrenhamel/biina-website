import { and, desc, eq, isNull } from 'drizzle-orm';
import { getDb } from '@/server/db';
import { workflowNotifications, users } from '@/server/db/schema';
import { getEmailService } from '@/server/email';
import { logger } from '@/lib/logger';

/**
 * Provider-independent NotificationService. Phase 12 ships IN_APP (persisted) and
 * EMAIL (via the existing dev email provider); PUSH / SLACK / WHATSAPP are future
 * channels behind the same interface. Notifications are DEDUPED by (user, dedupeKey)
 * so retries and unchanged conditions never produce duplicate alerts.
 */

export type NotifyKind = 'result' | 'failure' | 'approval_needed' | 'condition_matched' | 'auto_paused';

export async function notify(input: {
  userId: string;
  organizationId?: string | null;
  workflowId?: string | null;
  workflowRunId?: string | null;
  kind: NotifyKind;
  title: string;
  body?: string;
  dedupeKey?: string;
  email?: boolean;
}): Promise<void> {
  // In-app (deduped). A duplicate dedupeKey is a no-op.
  try {
    await getDb()
      .insert(workflowNotifications)
      .values({ userId: input.userId, organizationId: input.organizationId ?? null, workflowId: input.workflowId ?? null, workflowRunId: input.workflowRunId ?? null, channel: 'IN_APP', kind: input.kind, title: input.title.slice(0, 200), body: input.body?.slice(0, 1000), dedupeKey: input.dedupeKey ?? null })
      .onConflictDoNothing();
  } catch (e) {
    logger.warn('workflow.notify.failed', { error: String(e) });
  }

  // Optional email (best-effort, provider-independent). Never blocks the run.
  if (input.email) {
    try {
      const [u] = await getDb().select({ email: users.email }).from(users).where(eq(users.id, input.userId)).limit(1);
      if (u?.email) await getEmailService().send({ to: u.email, subject: input.title.slice(0, 200), text: input.body ?? input.title });
    } catch (e) {
      logger.warn('workflow.notify.email_failed', { error: String(e) });
    }
  }
}

export async function listNotifications(userId: string, limit = 30) {
  return getDb().select().from(workflowNotifications).where(eq(workflowNotifications.userId, userId)).orderBy(desc(workflowNotifications.createdAt)).limit(limit);
}

export async function markNotificationsRead(userId: string): Promise<void> {
  await getDb().update(workflowNotifications).set({ readAt: new Date() }).where(and(eq(workflowNotifications.userId, userId), isNull(workflowNotifications.readAt)));
}
