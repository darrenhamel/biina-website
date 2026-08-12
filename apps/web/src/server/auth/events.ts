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
  | 'file.reprocessed'
  // Phase 10 — connectors / external integrations.
  | 'connector.connected'
  | 'connector.revoked'
  | 'connector.reauth_required'
  | 'connector.search'
  | 'connector.read'
  | 'connector.action_attempted'
  | 'connector.action_blocked'
  // Phase 11 — agent engine / safe tool execution.
  | 'agent.session_started'
  | 'agent.session_completed'
  | 'agent.session_canceled'
  | 'agent.session_blocked'
  | 'agent.tool_proposed'
  | 'agent.tool_allowed'
  | 'agent.tool_denied'
  | 'agent.approval_requested'
  | 'agent.approval_approved'
  | 'agent.approval_rejected'
  | 'agent.action_executed'
  | 'agent.action_failed'
  | 'agent.action_unknown_outcome'
  | 'agent.policy_changed'
  // Phase 12 — workflows / scheduled automations.
  | 'workflow.created'
  | 'workflow.updated'
  | 'workflow.activated'
  | 'workflow.paused'
  | 'workflow.resumed'
  | 'workflow.disabled'
  | 'workflow.auto_paused'
  | 'workflow.archived'
  | 'workflow.run_started'
  | 'workflow.run_completed'
  | 'workflow.run_failed'
  | 'workflow.run_blocked'
  | 'workflow.run_skipped'
  | 'workflow.approval_needed'
  | 'workflow.standing_auth_created'
  | 'workflow.standing_auth_revoked'
  | 'workflow.standing_auth_used'
  | 'workflow.self_modification_blocked'
  | 'workflow.policy_changed'
  // Phase 13 — memory / personalization.
  | 'memory.created'
  | 'memory.edited'
  | 'memory.deleted'
  | 'memory.superseded'
  | 'memory.expired'
  | 'memory.cleared'
  | 'memory.imported'
  | 'memory.consent_changed'
  | 'memory.candidate_created'
  | 'memory.candidate_rejected'
  | 'memory.poisoning_blocked'
  // Phase 14 — multimodal (vision / OCR / audio / voice).
  | 'media.uploaded'
  | 'media.deleted'
  | 'media.vision'
  | 'media.ocr'
  | 'media.transcribed'
  | 'media.synthesized'
  | 'media.rejected'
  // Phase 15 — advanced research / multi-agent orchestration.
  | 'research.started'
  | 'research.plan_generated'
  | 'research.task_started'
  | 'research.task_completed'
  | 'research.source_accessed'
  | 'research.claim_verified'
  | 'research.conflict_detected'
  | 'research.synthesis_completed'
  | 'research.completed'
  | 'research.canceled'
  | 'research.budget_exhausted'
  | 'research.blocked'
  // Phase 16 — personas / experience profiles + template library / marketplace.
  | 'experience.changed'
  | 'library.item_created'
  | 'library.item_updated'
  | 'library.version_created'
  | 'library.submitted'
  | 'library.review_started'
  | 'library.approved'
  | 'library.rejected'
  | 'library.changes_requested'
  | 'library.published'
  | 'library.suspended'
  | 'library.deprecated'
  | 'library.installed'
  | 'library.install_blocked'
  | 'library.activated'
  | 'library.updated_install'
  | 'library.update_blocked'
  | 'library.forked'
  | 'library.uninstalled'
  | 'library.org_curation_changed'
  | 'library.org_policy_changed'
  | 'library.validation_blocked';

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
