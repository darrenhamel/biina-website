import { and, desc, eq, gte, lte } from 'drizzle-orm';
import { getDb } from '@/server/db';
import { securityEvents } from '@/server/db/schema';
import { logSecurityEvent } from '@/server/auth/events';

/**
 * Enterprise audit query + export. Organization-scoped and permission-gated (the route
 * requires the `audit.read` permission). Content is metadata only — never prompts,
 * documents, tokens, or secrets. Ordinary members cannot read or export the audit log.
 * Records are never editable by organization users (append-only via logSecurityEvent).
 */

export interface AuditFilter {
  organizationId: string;
  from?: Date;
  to?: Date;
  actorUserId?: string;
  event?: string;
  limit?: number;
}

export interface AuditRow {
  id: string;
  event: string;
  actorUserId: string | null;
  userId: string | null;
  ip: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
}

export async function queryAudit(filter: AuditFilter): Promise<AuditRow[]> {
  const clauses = [eq(securityEvents.organizationId, filter.organizationId)];
  if (filter.from) clauses.push(gte(securityEvents.createdAt, filter.from));
  if (filter.to) clauses.push(lte(securityEvents.createdAt, filter.to));
  if (filter.actorUserId) clauses.push(eq(securityEvents.actorUserId, filter.actorUserId));
  if (filter.event) clauses.push(eq(securityEvents.event, filter.event));
  const rows = await getDb()
    .select()
    .from(securityEvents)
    .where(and(...clauses))
    .orderBy(desc(securityEvents.createdAt))
    .limit(Math.min(filter.limit ?? 500, 5000));
  return rows.map((r) => ({ id: r.id, event: r.event, actorUserId: r.actorUserId, userId: r.userId, ip: r.ip, metadata: r.metadata as Record<string, unknown> | null, createdAt: r.createdAt.toISOString() }));
}

const SECRET_KEY = /token|secret|password|key|credential|authorization/i;
function redactMetadata(meta: Record<string, unknown> | null): Record<string, unknown> | null {
  if (!meta) return null;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(meta)) out[k] = SECRET_KEY.test(k) ? '[redacted]' : v;
  return out;
}

/** Export audit metadata as CSV or JSON (SIEM-friendly). Never includes secrets. */
export async function exportAudit(filter: AuditFilter, format: 'csv' | 'json', actorUserId: string): Promise<{ contentType: string; body: string; filename: string }> {
  const rows = (await queryAudit({ ...filter, limit: filter.limit ?? 5000 })).map((r) => ({ ...r, metadata: redactMetadata(r.metadata) }));
  await logSecurityEvent({ event: 'enterprise.audit_exported', actorUserId, organizationId: filter.organizationId, metadata: { format, count: rows.length } });
  if (format === 'json') {
    return { contentType: 'application/json', body: JSON.stringify({ organizationId: filter.organizationId, exportedAt: new Date().toISOString(), events: rows }, null, 2), filename: `audit-${filter.organizationId}.json` };
  }
  const header = 'id,createdAt,event,actorUserId,userId,ip,metadata';
  const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const lines = rows.map((r) => [r.id, r.createdAt, r.event, r.actorUserId, r.userId, r.ip, JSON.stringify(r.metadata ?? {})].map(esc).join(','));
  return { contentType: 'text/csv', body: [header, ...lines].join('\n'), filename: `audit-${filter.organizationId}.csv` };
}
