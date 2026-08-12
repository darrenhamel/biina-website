import { eq } from 'drizzle-orm';
import { getDb } from '@/server/db';
import { workflows, workflowTriggers } from '@/server/db/schema';
import type { Workflow, WorkflowTrigger, Plan } from '@/server/db/schema';
import { logSecurityEvent } from '@/server/auth/events';
import type { CreateWorkflowInput } from '@/lib/validation';
import { isValidTimezone, computeNextRun, type Schedule } from './schedule';
import { hardMaxSteps, minCheckIntervalMinutes } from './config';
import { snapshotVersion } from './store';

/**
 * WorkflowCompiler — converts user-friendly / natural-language configuration into a
 * VALIDATED structured workflow. Raw LLM output is never executed: NL is turned into
 * a DRAFT (deterministic heuristics for schedule; the text becomes the goal) that the
 * user must review + validate before activation.
 */

export interface ValidationIssue {
  field: string;
  message: string;
}

/** Validate a workflow + trigger config before it may be activated. */
export function validateWorkflowConfig(input: CreateWorkflowInput): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const tz = input.timezone || input.trigger.timezone || 'UTC';
  if (!isValidTimezone(tz)) issues.push({ field: 'timezone', message: `Unknown timezone "${tz}".` });

  if (input.trigger.type === 'SCHEDULE') {
    const s = input.trigger.schedule;
    if (!s) issues.push({ field: 'trigger.schedule', message: 'A schedule is required.' });
    else {
      if (s.pattern !== 'cron' && s.pattern !== 'once' && !s.time) issues.push({ field: 'trigger.schedule.time', message: 'A time of day is required.' });
      if (s.pattern === 'weekly' && s.weekday == null) issues.push({ field: 'trigger.schedule.weekday', message: 'A weekday is required.' });
      if (s.pattern === 'monthly' && s.day == null) issues.push({ field: 'trigger.schedule.day', message: 'A day of month is required.' });
      if (s.pattern === 'once' && !s.at) issues.push({ field: 'trigger.schedule.at', message: 'A date/time is required.' });
      // Only compute the next run when the timezone is valid (else it would throw).
      if (isValidTimezone(tz) && s.pattern !== 'cron' && s.pattern !== 'once' && s.time && !computeNextRun(s as Schedule, tz)) {
        issues.push({ field: 'trigger.schedule', message: 'This schedule never produces a next run.' });
      }
    }
  }
  if (input.trigger.type === 'CONDITION') {
    const interval = input.trigger.checkIntervalMinutes ?? 0;
    if (interval < minCheckIntervalMinutes()) issues.push({ field: 'trigger.checkIntervalMinutes', message: `Minimum check interval is ${minCheckIntervalMinutes()} minutes.` });
  }
  if ((input.maxSteps ?? 8) > hardMaxSteps()) issues.push({ field: 'maxSteps', message: `Steps cannot exceed the platform limit of ${hardMaxSteps()}.` });
  return issues;
}

/** Persist a new workflow (DRAFT) + its trigger + first version snapshot. */
export async function createWorkflow(input: CreateWorkflowInput, ctx: { userId: string; organizationId: string | null }): Promise<Workflow> {
  const ownerType = input.ownerType;
  const tz = input.timezone || input.trigger.timezone || 'UTC';
  const [wf] = await getDb()
    .insert(workflows)
    .values({
      ownerType,
      userId: ownerType === 'PERSONAL' ? ctx.userId : null,
      organizationId: ownerType === 'ORGANIZATION' ? ctx.organizationId : null,
      name: input.name,
      description: input.description ?? null,
      goal: input.goal,
      status: 'DRAFT',
      triggerType: input.trigger.type,
      agentMode: input.agentMode,
      approvalPolicy: input.approvalPolicy,
      timezone: tz,
      knowledgeBaseIds: input.knowledgeBaseIds ?? [],
      connectionIds: input.connectionIds ?? [],
      webSearchEnabled: input.webSearchEnabled ?? false,
      maxSteps: input.maxSteps ?? 8,
      maxToolCalls: input.maxToolCalls ?? 16,
      maxWritesPerRun: input.maxWritesPerRun ?? 1,
      maxCostPerRun: input.maxCostPerRun ?? null,
      maxRunsPerDay: input.maxRunsPerDay ?? null,
      maxRunsPerMonth: input.maxRunsPerMonth ?? null,
      notifyOnSuccess: input.notifyOnSuccess ?? 'MEANINGFUL',
      notifyOnFailure: input.notifyOnFailure ?? true,
      createdByUserId: ctx.userId,
    })
    .returning();

  await getDb().insert(workflowTriggers).values({
    workflowId: wf.id,
    type: input.trigger.type,
    schedule: input.trigger.schedule ?? null,
    timezone: tz,
    conditionType: input.trigger.conditionType ?? null,
    conditionConfig: input.trigger.conditionConfig ?? null,
    checkIntervalMinutes: input.trigger.checkIntervalMinutes ?? null,
    missedRunPolicy: input.trigger.missedRunPolicy ?? 'RUN_ONCE_WHEN_RECOVERED',
  });
  await snapshotVersion(wf, ctx.userId);
  await logSecurityEvent({ event: 'workflow.created', userId: ctx.userId, actorUserId: ctx.userId, organizationId: ctx.organizationId, metadata: { workflowId: wf.id, ownerType } });
  return wf;
}

/**
 * Turn a natural-language request into a DRAFT workflow config using deterministic
 * heuristics (never executing raw model JSON). The text becomes the goal; simple
 * phrases set a suggested schedule. The user validates + activates afterwards.
 */
export function draftFromNaturalLanguage(text: string, timezone = 'UTC'): CreateWorkflowInput {
  const t = text.toLowerCase();
  const time = /(\d{1,2})\s*(am|pm)/.exec(t);
  const hhmm = time ? `${(Number(time[1]) % 12) + (time[2] === 'pm' ? 12 : 0)}`.padStart(2, '0') + ':00' : '08:00';
  const weekdays = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  let trigger: CreateWorkflowInput['trigger'] = { type: 'MANUAL' };
  const wd = weekdays.findIndex((d) => t.includes(d));
  if (/every day|daily|each morning|every morning|weekday/.test(t)) trigger = { type: 'SCHEDULE', schedule: { pattern: 'daily', time: hhmm }, timezone };
  else if (/every week|weekly/.test(t) || wd >= 0) trigger = { type: 'SCHEDULE', schedule: { pattern: 'weekly', time: hhmm, weekday: wd >= 0 ? wd : 1 }, timezone };
  else if (/every month|monthly/.test(t)) trigger = { type: 'SCHEDULE', schedule: { pattern: 'monthly', time: hhmm, day: 1 }, timezone };
  else if (/check|monitor|watch|flag|when a new/.test(t)) trigger = { type: 'CONDITION', checkIntervalMinutes: 60, conditionType: 'CONNECTOR_NEW_ITEMS' };

  // Send INTENT (a verb), not merely the noun "email" — "unread emails" is a read.
  const wantsSend = /\b(send|post|reply|forward)\b/.test(t) || /\bemail\b\s+(?:the|it|them|this|that|a |to )/.test(t);
  return {
    name: text.slice(0, 60),
    goal: text,
    ownerType: 'PERSONAL',
    agentMode: 'AGENT',
    approvalPolicy: wantsSend ? 'ASK_EVERY_WRITE' : 'READ_ONLY_AUTOMATIC',
    timezone,
    trigger,
    maxWritesPerRun: wantsSend ? 1 : 0,
    notifyOnSuccess: 'MEANINGFUL',
    notifyOnFailure: true,
  };
}

/** Human-readable activation review (what the workflow will do). */
export function activationSummary(wf: Workflow, trigger: WorkflowTrigger | null, plan: Plan): {
  schedule: string;
  access: string[];
  externalWrites: string;
  maxRunsPerMonth: number | null;
  approvalPolicy: string;
} {
  let schedule = 'Manual only';
  if (trigger?.type === 'SCHEDULE' && trigger.schedule) {
    const s = trigger.schedule as Schedule;
    schedule = `${s.pattern}${s.time ? ` at ${s.time}` : ''} (${wf.timezone})`;
  } else if (trigger?.type === 'CONDITION') {
    schedule = `Check every ${trigger.checkIntervalMinutes ?? '?'} min (${wf.timezone})`;
  }
  const access: string[] = [];
  if (wf.knowledgeBaseIds.length) access.push(`Knowledge bases (${wf.knowledgeBaseIds.length})`);
  if (wf.connectionIds.length) access.push(`Connected apps (${wf.connectionIds.length}) — read`);
  if (wf.webSearchEnabled) access.push('Web search');
  const externalWrites = wf.maxWritesPerRun > 0 ? `Up to ${wf.maxWritesPerRun}/run (requires approval or standing authorization)` : 'None';
  const perMonth = wf.maxRunsPerMonth ?? plan.workflowRunsPerMonth ?? null;
  return { schedule, access, externalWrites, maxRunsPerMonth: perMonth, approvalPolicy: wf.approvalPolicy };
}

export async function getWorkflowTrigger(workflowId: string): Promise<WorkflowTrigger | null> {
  const [t] = await getDb().select().from(workflowTriggers).where(eq(workflowTriggers.workflowId, workflowId)).limit(1);
  return t ?? null;
}
