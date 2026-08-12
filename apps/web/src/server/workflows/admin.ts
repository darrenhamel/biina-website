import { and, desc, eq, gte, sql } from 'drizzle-orm';
import { getDb } from '@/server/db';
import { workflows, workflowRuns } from '@/server/db/schema';
import { workflowsEnabled, schedulerEnabled, scheduledWritesEnabled } from './config';

/**
 * Admin observability for automations. Operational metadata only — never private
 * workflow content, arguments, or recipients. Org managers see only their org.
 */

export async function automationsOverview(scope: { organizationId?: string | null } = {}): Promise<{
  killSwitches: { workflowsEnabled: boolean; schedulerEnabled: boolean; scheduledWritesEnabled: boolean };
  workflows: { total: number; active: number; paused: number; autoPaused: number; draft: number };
  runsToday: number;
  runs: { completed: number; failed: number; blocked: number; awaitingApproval: number; skipped: number };
  scheduledWrites: number;
  avgCost: number;
  queueDepth: number;
  recent: Array<{ id: string; workflowId: string; status: string; trigger: string; createdAt: string; writeActions: number }>;
  schedulerHealth: { overdue: number };
}> {
  const db = getDb();
  const since = new Date(Date.now() - 30 * 24 * 60 * 60_000);
  const startOfDay = new Date(); startOfDay.setUTCHours(0, 0, 0, 0);
  const wfFilter = scope.organizationId ? eq(workflows.organizationId, scope.organizationId) : undefined;
  const runFilter = scope.organizationId ? and(gte(workflowRuns.createdAt, since), eq(workflowRuns.organizationId, scope.organizationId)) : gte(workflowRuns.createdAt, since);

  const [wfRows, runRows, todayRows, recentRows, queueRows, overdueRows] = await Promise.all([
    db.select({ status: workflows.status }).from(workflows).where(wfFilter ?? sql`true`),
    db.select({ status: workflowRuns.status, cost: workflowRuns.estimatedCost, writes: workflowRuns.writeActions }).from(workflowRuns).where(runFilter),
    db.select({ n: sql<number>`count(*)::int` }).from(workflowRuns).where(scope.organizationId ? and(gte(workflowRuns.createdAt, startOfDay), eq(workflowRuns.organizationId, scope.organizationId)) : gte(workflowRuns.createdAt, startOfDay)),
    db.select({ id: workflowRuns.id, workflowId: workflowRuns.workflowId, status: workflowRuns.status, trigger: workflowRuns.triggerType, createdAt: workflowRuns.createdAt, writes: workflowRuns.writeActions }).from(workflowRuns).where(runFilter).orderBy(desc(workflowRuns.createdAt)).limit(20),
    db.select({ n: sql<number>`count(*)::int` }).from(workflowRuns).where(eq(workflowRuns.status, 'QUEUED')),
    db.select({ n: sql<number>`count(*)::int` }).from(workflows).where(and(eq(workflows.status, 'ACTIVE'), sql`${workflows.nextRunAt} < now() - interval '5 minutes'`)),
  ]);

  const costs = runRows.map((r) => Number(r.cost ?? 0));
  return {
    killSwitches: { workflowsEnabled: workflowsEnabled(), schedulerEnabled: schedulerEnabled(), scheduledWritesEnabled: scheduledWritesEnabled() },
    workflows: {
      total: wfRows.length,
      active: wfRows.filter((w) => w.status === 'ACTIVE').length,
      paused: wfRows.filter((w) => w.status === 'PAUSED').length,
      autoPaused: wfRows.filter((w) => w.status === 'AUTO_PAUSED').length,
      draft: wfRows.filter((w) => w.status === 'DRAFT').length,
    },
    runsToday: todayRows[0]?.n ?? 0,
    runs: {
      completed: runRows.filter((r) => r.status === 'COMPLETED').length,
      failed: runRows.filter((r) => r.status === 'FAILED').length,
      blocked: runRows.filter((r) => r.status === 'BLOCKED').length,
      awaitingApproval: runRows.filter((r) => r.status === 'AWAITING_APPROVAL').length,
      skipped: runRows.filter((r) => r.status === 'SKIPPED').length,
    },
    scheduledWrites: runRows.reduce((n, r) => n + (r.writes ?? 0), 0),
    avgCost: costs.length ? Math.round((costs.reduce((a, b) => a + b, 0) / costs.length) * 10000) / 10000 : 0,
    queueDepth: queueRows[0]?.n ?? 0,
    recent: recentRows.map((r) => ({ id: r.id, workflowId: r.workflowId, status: r.status, trigger: r.trigger, createdAt: r.createdAt.toISOString(), writeActions: r.writes })),
    schedulerHealth: { overdue: overdueRows[0]?.n ?? 0 },
  };
}
