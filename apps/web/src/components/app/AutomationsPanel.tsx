'use client';

import { useCallback, useEffect, useState } from 'react';
import type { Locale } from '@/i18n/config';
import type { Dictionary } from '@/i18n/dictionaries';
import { Icon } from '@/components/Icon';

// ---- Types (mirror the API shapes; UI-only) ----

type WorkflowStatus = 'DRAFT' | 'ACTIVE' | 'PAUSED' | 'DISABLED' | 'ARCHIVED' | 'AUTO_PAUSED';
type RunStatus =
  | 'QUEUED'
  | 'RUNNING'
  | 'AWAITING_APPROVAL'
  | 'COMPLETED'
  | 'PARTIALLY_COMPLETED'
  | 'FAILED'
  | 'CANCELED'
  | 'SKIPPED'
  | 'BLOCKED';

interface WorkflowListItem {
  id: string;
  name: string;
  description: string | null;
  status: WorkflowStatus;
  triggerType: string;
  timezone: string;
  approvalPolicy: string;
  nextRunAt: string | null;
  lastRunAt: string | null;
}

interface TemplateItem {
  slug: string;
  name: string;
  description: string;
  goal: string;
  suggestedTrigger: {
    type: 'SCHEDULE' | 'CONDITION';
    pattern?: 'daily' | 'weekly' | 'monthly';
    time?: string;
    weekday?: number;
    checkIntervalMinutes?: number;
  };
  approvalPolicy: 'READ_ONLY_AUTOMATIC' | 'ASK_EVERY_WRITE';
  needsConnectors: boolean;
  needsWrite: boolean;
}

interface NotificationItem {
  id: string;
  kind: string;
  title: string;
  body: string | null;
  workflowId: string | null;
  readAt: string | null;
  createdAt: string;
}

interface Issue {
  field: string;
  message: string;
}

type View =
  | { kind: 'hub' }
  | { kind: 'builder'; prefill?: Partial<BuilderState> }
  | { kind: 'detail'; id: string; justCreated?: boolean };

type OwnerType = 'PERSONAL' | 'ORGANIZATION';
type AgentMode = 'ASSISTED' | 'AGENT';
type ApprovalPolicy = 'ASK_EVERY_WRITE' | 'ASK_HIGH_RISK_ONLY' | 'READ_ONLY_AUTOMATIC';
type TriggerType = 'MANUAL' | 'SCHEDULE';
type Pattern = 'once' | 'daily' | 'weekly' | 'monthly';

interface BuilderState {
  name: string;
  goal: string;
  ownerType: OwnerType;
  agentMode: AgentMode;
  approvalPolicy: ApprovalPolicy;
  timezone: string;
  triggerType: TriggerType;
  pattern: Pattern;
  time: string;
  weekday: number;
  day: number;
  at: string;
  knowledgeBaseIds: string;
  connectionIds: string;
  webSearchEnabled: boolean;
  maxSteps: string;
  maxWritesPerRun: string;
  maxRunsPerMonth: string;
  notifyOnSuccess: 'NEVER' | 'MEANINGFUL' | 'EVERY';
  notifyOnFailure: boolean;
}

const DEFAULT_TZ = 'Asia/Dubai';
const TIMEZONES = [
  'Asia/Dubai',
  'Asia/Riyadh',
  'UTC',
  'Europe/London',
  'Europe/Paris',
  'America/New_York',
  'Asia/Karachi',
  'Asia/Kolkata',
];

function emptyBuilder(): BuilderState {
  return {
    name: '',
    goal: '',
    ownerType: 'PERSONAL',
    agentMode: 'AGENT',
    approvalPolicy: 'ASK_EVERY_WRITE',
    timezone: DEFAULT_TZ,
    triggerType: 'MANUAL',
    pattern: 'daily',
    time: '08:00',
    weekday: 1,
    day: 1,
    at: '',
    knowledgeBaseIds: '',
    connectionIds: '',
    webSearchEnabled: false,
    maxSteps: '',
    maxWritesPerRun: '',
    maxRunsPerMonth: '',
    notifyOnSuccess: 'MEANINGFUL',
    notifyOnFailure: true,
  };
}

// ---- Formatting helpers ----

function fmtInTz(iso: string | null, tz: string, locale: Locale): string {
  if (!iso) return '—';
  const opts: Intl.DateTimeFormatOptions = { dateStyle: 'medium', timeStyle: 'short' };
  try {
    return new Intl.DateTimeFormat(locale === 'ar' ? 'ar-AE' : 'en-US', { ...opts, timeZone: tz }).format(
      new Date(iso),
    );
  } catch {
    return new Intl.DateTimeFormat(locale === 'ar' ? 'ar-AE' : 'en-US', opts).format(new Date(iso));
  }
}

// ---- Badges ----

function wfStatusLabel(status: WorkflowStatus, dict: Dictionary): string {
  const map: Record<WorkflowStatus, string> = {
    DRAFT: dict.automations.statusDraft,
    ACTIVE: dict.automations.statusActive,
    PAUSED: dict.automations.statusPaused,
    DISABLED: dict.automations.statusDisabled,
    ARCHIVED: dict.automations.statusArchived,
    AUTO_PAUSED: dict.automations.statusAutoPaused,
  };
  return map[status] ?? status;
}

function wfStatusClass(status: WorkflowStatus): string {
  switch (status) {
    case 'ACTIVE':
      return 'bg-success/15 text-success';
    case 'AUTO_PAUSED':
      return 'bg-danger/10 text-danger';
    case 'PAUSED':
      return 'bg-gold/15 text-gold';
    case 'DRAFT':
      return 'bg-accent-soft text-accent';
    default:
      return 'bg-paper-sunken text-ink-soft';
  }
}

function runStatusLabel(status: RunStatus, dict: Dictionary): string {
  const map: Record<RunStatus, string> = {
    QUEUED: dict.automations.runQueued,
    RUNNING: dict.automations.runRunning,
    AWAITING_APPROVAL: dict.automations.runAwaitingApproval,
    COMPLETED: dict.automations.runCompleted,
    PARTIALLY_COMPLETED: dict.automations.runPartial,
    FAILED: dict.automations.runFailed,
    CANCELED: dict.automations.runCanceled,
    SKIPPED: dict.automations.runSkipped,
    BLOCKED: dict.automations.runBlocked,
  };
  return map[status] ?? status;
}

function runStatusClass(status: RunStatus): string {
  switch (status) {
    case 'COMPLETED':
      return 'bg-success/15 text-success';
    case 'FAILED':
    case 'BLOCKED':
      return 'bg-danger/10 text-danger';
    case 'AWAITING_APPROVAL':
    case 'PARTIALLY_COMPLETED':
      return 'bg-gold/15 text-gold';
    case 'RUNNING':
    case 'QUEUED':
      return 'bg-accent-soft text-accent';
    default:
      return 'bg-paper-sunken text-ink-soft';
  }
}

function riskLabel(risk: string, dict: Dictionary): string {
  switch (risk) {
    case 'READ_ONLY':
      return dict.agent.riskReadOnly;
    case 'REVERSIBLE_WRITE':
      return dict.agent.riskReversibleWrite;
    case 'EXTERNAL_COMMUNICATION':
      return dict.agent.riskExternalComms;
    case 'DESTRUCTIVE':
      return dict.agent.riskDestructive;
    default:
      return dict.agent.riskOther;
  }
}

function riskClass(risk: string): string {
  switch (risk) {
    case 'READ_ONLY':
      return 'bg-success/15 text-success';
    case 'REVERSIBLE_WRITE':
      return 'bg-accent-soft text-accent';
    case 'EXTERNAL_COMMUNICATION':
      return 'bg-gold/15 text-gold';
    case 'DESTRUCTIVE':
      return 'bg-danger/10 text-danger';
    default:
      return 'bg-paper-sunken text-ink-soft';
  }
}

function WfStatusBadge({ status, dict }: { status: WorkflowStatus; dict: Dictionary }) {
  return (
    <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${wfStatusClass(status)}`}>
      {wfStatusLabel(status, dict)}
    </span>
  );
}

function RunStatusBadge({ status, dict }: { status: RunStatus; dict: Dictionary }) {
  return (
    <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${runStatusClass(status)}`}>
      {runStatusLabel(status, dict)}
    </span>
  );
}

// ---- Root panel ----

export function AutomationsPanel({ locale, dict }: { locale: Locale; dict: Dictionary }) {
  const [view, setView] = useState<View>({ kind: 'hub' });

  return (
    <div className="scroll-slim h-full overflow-y-auto">
      <div className="mx-auto max-w-3xl px-5 py-8">
        {view.kind === 'hub' && <Hub locale={locale} dict={dict} setView={setView} />}
        {view.kind === 'builder' && (
          <WorkflowBuilder
            locale={locale}
            dict={dict}
            prefill={view.prefill}
            onCancel={() => setView({ kind: 'hub' })}
            onCreated={(id) => setView({ kind: 'detail', id, justCreated: true })}
          />
        )}
        {view.kind === 'detail' && (
          <WorkflowDetail
            locale={locale}
            dict={dict}
            id={view.id}
            justCreated={view.justCreated}
            onBack={() => setView({ kind: 'hub' })}
          />
        )}
      </div>
    </div>
  );
}

// ---- Hub (list, templates, history, notifications) ----

function Hub({
  locale,
  dict,
  setView,
}: {
  locale: Locale;
  dict: Dictionary;
  setView: (v: View) => void;
}) {
  const [tab, setTab] = useState<'workflows' | 'templates' | 'history'>('workflows');
  const [workflows, setWorkflows] = useState<WorkflowListItem[] | null>(null);
  const [templates, setTemplates] = useState<TemplateItem[] | null>(null);
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [showNotif, setShowNotif] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadWorkflows = useCallback(async () => {
    try {
      const res = await fetch('/api/workflows', { cache: 'no-store' });
      if (res.status === 403) {
        setError(dict.automations.unavailable);
        setWorkflows([]);
        return;
      }
      if (!res.ok) throw new Error();
      const body = await res.json();
      setWorkflows(Array.isArray(body.workflows) ? body.workflows : []);
    } catch {
      setError(dict.common.somethingWrong);
      setWorkflows([]);
    }
  }, [dict]);

  const loadTemplates = useCallback(async () => {
    try {
      const res = await fetch('/api/workflows/templates', { cache: 'no-store' });
      if (!res.ok) throw new Error();
      const body = await res.json();
      setTemplates(Array.isArray(body.templates) ? body.templates : []);
    } catch {
      setTemplates([]);
    }
  }, []);

  const loadNotifications = useCallback(async () => {
    try {
      const res = await fetch('/api/notifications', { cache: 'no-store' });
      if (!res.ok) return;
      const body = await res.json();
      setNotifications(Array.isArray(body.notifications) ? body.notifications : []);
    } catch {
      /* non-fatal */
    }
  }, []);

  useEffect(() => {
    void loadWorkflows();
    void loadTemplates();
    void loadNotifications();
  }, [loadWorkflows, loadTemplates, loadNotifications]);

  async function markAllRead() {
    try {
      await fetch('/api/notifications', { method: 'POST' });
      await loadNotifications();
    } catch {
      /* non-fatal */
    }
  }

  function applyTemplate(t: TemplateItem) {
    const prefill: Partial<BuilderState> = {
      name: t.name,
      goal: t.goal,
      approvalPolicy: t.approvalPolicy,
    };
    if (t.suggestedTrigger.type === 'SCHEDULE' && t.suggestedTrigger.pattern) {
      prefill.triggerType = 'SCHEDULE';
      prefill.pattern = t.suggestedTrigger.pattern;
      if (t.suggestedTrigger.time) prefill.time = t.suggestedTrigger.time;
      if (typeof t.suggestedTrigger.weekday === 'number') prefill.weekday = t.suggestedTrigger.weekday;
    } else {
      prefill.triggerType = 'MANUAL';
    }
    setView({ kind: 'builder', prefill });
  }

  const unread = notifications.filter((n) => !n.readAt).length;
  const allRuns: WorkflowListItem[] = (workflows ?? []).filter((w) => w.lastRunAt);

  return (
    <>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-ink">{dict.automations.title}</h1>
          <p className="mt-1 text-sm text-ink-soft">{dict.automations.subtitle}</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <button
              type="button"
              onClick={() => setShowNotif((v) => !v)}
              className="btn-ghost relative p-2"
              aria-label={dict.automations.notifTitle}
              aria-expanded={showNotif}
            >
              <Icon name="bell" width={18} height={18} />
              {unread > 0 && (
                <span className="absolute -end-0.5 -top-0.5 grid h-4 min-w-4 place-items-center rounded-full bg-accent px-1 text-[10px] font-bold text-on-accent">
                  {unread}
                </span>
              )}
            </button>
            {showNotif && (
              <>
                <button className="fixed inset-0 z-10" aria-hidden onClick={() => setShowNotif(false)} />
                <div className="absolute end-0 z-20 mt-1 w-80 overflow-hidden rounded-xl border border-line bg-paper-raised shadow-lg">
                  <div className="flex items-center justify-between border-b border-line px-3 py-2">
                    <p className="text-sm font-semibold text-ink">{dict.automations.notifTitle}</p>
                    {notifications.length > 0 && (
                      <button
                        type="button"
                        onClick={markAllRead}
                        className="text-xs font-medium text-accent hover:underline"
                      >
                        {dict.automations.markAllRead}
                      </button>
                    )}
                  </div>
                  <ul className="scroll-slim max-h-80 overflow-y-auto">
                    {notifications.length === 0 ? (
                      <li className="px-3 py-4 text-sm text-ink-faint">{dict.automations.notifEmpty}</li>
                    ) : (
                      notifications.map((n) => (
                        <li
                          key={n.id}
                          className={`border-b border-line px-3 py-2.5 last:border-b-0 ${
                            n.readAt ? '' : 'bg-accent-soft/40'
                          }`}
                        >
                          <p className="text-sm font-medium text-ink">{n.title}</p>
                          {n.body && <p className="mt-0.5 text-xs text-ink-soft">{n.body}</p>}
                          <p className="mt-1 text-[11px] text-ink-faint">
                            {fmtInTz(n.createdAt, DEFAULT_TZ, locale)}
                          </p>
                        </li>
                      ))
                    )}
                  </ul>
                </div>
              </>
            )}
          </div>
          <button
            type="button"
            onClick={() => setView({ kind: 'builder' })}
            className="btn-primary gap-1.5 px-4 py-2 text-sm"
          >
            <Icon name="plus" width={16} height={16} />
            {dict.automations.newWorkflow}
          </button>
        </div>
      </div>

      {error && (
        <p role="alert" className="mt-4 rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger">
          {error}
        </p>
      )}

      {/* Tabs */}
      <div className="mt-6 flex gap-1 border-b border-line">
        <TabButton active={tab === 'workflows'} onClick={() => setTab('workflows')}>
          {dict.automations.tabWorkflows}
        </TabButton>
        <TabButton active={tab === 'templates'} onClick={() => setTab('templates')}>
          {dict.automations.tabTemplates}
        </TabButton>
        <TabButton active={tab === 'history'} onClick={() => setTab('history')}>
          {dict.automations.tabHistory}
        </TabButton>
      </div>

      {tab === 'workflows' && (
        <div className="mt-4 space-y-3">
          {workflows === null ? (
            <Loading />
          ) : workflows.length === 0 ? (
            <p className="rounded-xl border border-dashed border-line px-4 py-8 text-center text-sm text-ink-faint">
              {dict.automations.empty}
            </p>
          ) : (
            workflows.map((w) => (
              <WorkflowCard
                key={w.id}
                w={w}
                dict={dict}
                locale={locale}
                onOpen={() => setView({ kind: 'detail', id: w.id })}
                onChanged={loadWorkflows}
              />
            ))
          )}
        </div>
      )}

      {tab === 'templates' && (
        <div className="mt-4 space-y-3">
          {templates === null ? (
            <Loading />
          ) : templates.length === 0 ? (
            <p className="rounded-xl border border-dashed border-line px-4 py-8 text-center text-sm text-ink-faint">
              {dict.automations.emptyTemplates}
            </p>
          ) : (
            templates.map((t) => (
              <div key={t.slug} className="card p-4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-semibold text-ink">{t.name}</p>
                    <p className="mt-0.5 text-sm text-ink-soft">{t.description}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => applyTemplate(t)}
                    className="btn-primary px-3 py-1.5 text-xs"
                  >
                    {dict.automations.useTemplate}
                  </button>
                </div>
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {t.needsConnectors && (
                    <span className="rounded-full bg-paper-sunken px-2 py-0.5 text-[11px] font-medium text-ink-soft">
                      {dict.automations.needsConnectors}
                    </span>
                  )}
                  {t.needsWrite && (
                    <span className="rounded-full bg-gold/15 px-2 py-0.5 text-[11px] font-medium text-gold">
                      {dict.automations.needsWrite}
                    </span>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {tab === 'history' && (
        <div className="mt-4 space-y-3">
          {workflows === null ? (
            <Loading />
          ) : allRuns.length === 0 ? (
            <p className="rounded-xl border border-dashed border-line px-4 py-8 text-center text-sm text-ink-faint">
              {dict.automations.emptyHistory}
            </p>
          ) : (
            allRuns
              .slice()
              .sort((a, b) => (b.lastRunAt ?? '').localeCompare(a.lastRunAt ?? ''))
              .map((w) => (
                <button
                  key={w.id}
                  onClick={() => setView({ kind: 'detail', id: w.id })}
                  className="card flex w-full items-center justify-between gap-3 p-4 text-start transition-colors hover:border-accent"
                >
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium text-ink">{w.name}</span>
                    <span className="mt-0.5 block text-xs text-ink-faint">
                      {dict.automations.lastRun}: {fmtInTz(w.lastRunAt, w.timezone, locale)}
                    </span>
                  </span>
                  <WfStatusBadge status={w.status} dict={dict} />
                </button>
              ))
          )}
        </div>
      )}
    </>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium transition-colors ${
        active ? 'border-accent text-accent' : 'border-transparent text-ink-soft hover:text-ink'
      }`}
    >
      {children}
    </button>
  );
}

function Loading() {
  return (
    <div className="grid place-items-center py-10">
      <span className="h-6 w-6 animate-spin rounded-full border-2 border-line-strong border-t-accent" />
    </div>
  );
}

function WorkflowCard({
  w,
  dict,
  locale,
  onOpen,
  onChanged,
}: {
  w: WorkflowListItem;
  dict: Dictionary;
  locale: Locale;
  onOpen: () => void;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState(false);

  async function action(path: string) {
    setBusy(true);
    try {
      await fetch(`/api/workflows/${w.id}/${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: path === 'run' ? JSON.stringify({}) : undefined,
      });
      onChanged();
    } finally {
      setBusy(false);
    }
  }

  const scheduleText =
    w.triggerType === 'SCHEDULE'
      ? `${dict.automations.nextRun}: ${fmtInTz(w.nextRunAt, w.timezone, locale)}`
      : dict.automations.manualOnly;

  return (
    <div className="card p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <button onClick={onOpen} className="min-w-0 text-start">
          <span className="block truncate font-semibold text-ink hover:text-accent">{w.name}</span>
          {w.description && <span className="mt-0.5 block truncate text-sm text-ink-soft">{w.description}</span>}
        </button>
        <WfStatusBadge status={w.status} dict={dict} />
      </div>

      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-faint">
        <span>{scheduleText}</span>
        <span>
          {dict.automations.lastRun}: {w.lastRunAt ? fmtInTz(w.lastRunAt, w.timezone, locale) : dict.automations.neverRun}
        </span>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        <button onClick={() => action('run')} disabled={busy} className="btn-ghost px-2.5 py-1 text-xs">
          {dict.automations.runNow}
        </button>
        {w.status === 'ACTIVE' && (
          <button onClick={() => action('pause')} disabled={busy} className="btn-ghost px-2.5 py-1 text-xs">
            {dict.automations.pause}
          </button>
        )}
        {(w.status === 'PAUSED' || w.status === 'AUTO_PAUSED') && (
          <button onClick={() => action('resume')} disabled={busy} className="btn-ghost px-2.5 py-1 text-xs">
            {dict.automations.resume}
          </button>
        )}
        <button onClick={onOpen} className="btn-ghost px-2.5 py-1 text-xs">
          {dict.automations.viewDetails}
        </button>
      </div>
    </div>
  );
}

// ---- Builder ----

function parseIds(s: string): string[] {
  return s
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean);
}

function WorkflowBuilder({
  locale,
  dict,
  prefill,
  onCancel,
  onCreated,
}: {
  locale: Locale;
  dict: Dictionary;
  prefill?: Partial<BuilderState>;
  onCancel: () => void;
  onCreated: (id: string) => void;
}) {
  const [s, setS] = useState<BuilderState>({ ...emptyBuilder(), ...prefill });
  const [nl, setNl] = useState('');
  const [drafting, setDrafting] = useState(false);
  const [draftReady, setDraftReady] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [issues, setIssues] = useState<Issue[]>([]);
  const [error, setError] = useState<string | null>(null);

  function set<K extends keyof BuilderState>(key: K, value: BuilderState[K]) {
    setS((prev) => ({ ...prev, [key]: value }));
  }

  async function generateDraft() {
    const text = nl.trim();
    if (text.length < 5) return;
    setDrafting(true);
    setError(null);
    try {
      const res = await fetch('/api/workflows/compile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, timezone: s.timezone }),
      });
      if (res.status === 403) {
        setError(dict.automations.unavailable);
        return;
      }
      if (!res.ok) {
        setError(dict.common.somethingWrong);
        return;
      }
      const body = await res.json();
      applyDraft(body.draft);
      setDraftReady(true);
    } catch {
      setError(dict.common.somethingWrong);
    } finally {
      setDrafting(false);
    }
  }

  function applyDraft(draft: Record<string, unknown> | null | undefined) {
    if (!draft) return;
    setS((prev) => {
      const next = { ...prev };
      if (typeof draft.name === 'string' && draft.name) next.name = draft.name;
      if (typeof draft.goal === 'string' && draft.goal) next.goal = draft.goal;
      if (draft.approvalPolicy === 'ASK_EVERY_WRITE' || draft.approvalPolicy === 'ASK_HIGH_RISK_ONLY' || draft.approvalPolicy === 'READ_ONLY_AUTOMATIC')
        next.approvalPolicy = draft.approvalPolicy;
      if (draft.agentMode === 'ASSISTED' || draft.agentMode === 'AGENT') next.agentMode = draft.agentMode;
      if (typeof draft.timezone === 'string' && draft.timezone) next.timezone = draft.timezone;
      const trigger = draft.trigger as Record<string, unknown> | undefined;
      if (trigger && typeof trigger === 'object') {
        if (trigger.type === 'SCHEDULE') {
          next.triggerType = 'SCHEDULE';
          const sch = trigger.schedule as Record<string, unknown> | undefined;
          if (sch) {
            if (sch.pattern === 'once' || sch.pattern === 'daily' || sch.pattern === 'weekly' || sch.pattern === 'monthly')
              next.pattern = sch.pattern;
            if (typeof sch.time === 'string') next.time = sch.time;
            if (typeof sch.weekday === 'number') next.weekday = sch.weekday;
            if (typeof sch.day === 'number') next.day = sch.day;
          }
        } else if (trigger.type === 'MANUAL') {
          next.triggerType = 'MANUAL';
        }
      }
      return next;
    });
  }

  function buildTrigger() {
    if (s.triggerType !== 'SCHEDULE') return { type: 'MANUAL' as const };
    const schedule: Record<string, unknown> = { pattern: s.pattern };
    if (s.pattern === 'once') {
      schedule.at = s.at ? new Date(s.at).toISOString() : undefined;
    } else {
      schedule.time = s.time;
      if (s.pattern === 'weekly') schedule.weekday = s.weekday;
      if (s.pattern === 'monthly') schedule.day = s.day;
    }
    return { type: 'SCHEDULE' as const, schedule, timezone: s.timezone };
  }

  async function submit() {
    setSubmitting(true);
    setError(null);
    setIssues([]);
    try {
      const body: Record<string, unknown> = {
        name: s.name.trim(),
        goal: s.goal.trim(),
        ownerType: s.ownerType,
        agentMode: s.agentMode,
        approvalPolicy: s.approvalPolicy,
        timezone: s.timezone,
        trigger: buildTrigger(),
        webSearchEnabled: s.webSearchEnabled,
        notifyOnSuccess: s.notifyOnSuccess,
        notifyOnFailure: s.notifyOnFailure,
      };
      const kb = parseIds(s.knowledgeBaseIds);
      if (kb.length) body.knowledgeBaseIds = kb;
      const conn = parseIds(s.connectionIds);
      if (conn.length) body.connectionIds = conn;
      if (s.maxSteps) body.maxSteps = Number(s.maxSteps);
      if (s.maxWritesPerRun) body.maxWritesPerRun = Number(s.maxWritesPerRun);
      if (s.maxRunsPerMonth) body.maxRunsPerMonth = Number(s.maxRunsPerMonth);

      const res = await fetch('/api/workflows', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (res.status === 403) {
        setError(dict.automations.unavailable);
        return;
      }
      const data = await res.json().catch(() => null);
      if (res.status === 400 && data && data.ok === false && Array.isArray(data.issues)) {
        setIssues(data.issues);
        return;
      }
      if (!res.ok || !data || data.ok !== true) {
        setError(dict.common.somethingWrong);
        return;
      }
      onCreated(data.workflow.id);
    } catch {
      setError(dict.common.somethingWrong);
    } finally {
      setSubmitting(false);
    }
  }

  const canSubmit = s.name.trim().length >= 2 && s.goal.trim().length >= 5 && !submitting;
  const weekdayLabels = [
    dict.automations.weekdaySun,
    dict.automations.weekdayMon,
    dict.automations.weekdayTue,
    dict.automations.weekdayWed,
    dict.automations.weekdayThu,
    dict.automations.weekdayFri,
    dict.automations.weekdaySat,
  ];
  const tzOptions = TIMEZONES.includes(s.timezone) ? TIMEZONES : [s.timezone, ...TIMEZONES];

  return (
    <>
      <BackHeader title={dict.automations.builderTitle} onBack={onCancel} backLabel={dict.automations.back} />

      {error && (
        <p role="alert" className="mt-4 rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger">
          {error}
        </p>
      )}
      {issues.length > 0 && (
        <ul className="mt-4 space-y-1 rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger">
          {issues.map((i, idx) => (
            <li key={idx}>
              <span className="font-medium">{i.field}:</span> {i.message}
            </li>
          ))}
        </ul>
      )}

      {/* Natural language */}
      <section className="card mt-6 p-5">
        <label htmlFor="nl" className="text-sm font-semibold text-ink">
          {dict.automations.nlLabel}
        </label>
        <p className="mt-0.5 text-xs text-ink-faint">{dict.automations.nlHint}</p>
        <textarea
          id="nl"
          value={nl}
          onChange={(e) => setNl(e.target.value)}
          placeholder={dict.automations.nlPlaceholder}
          rows={2}
          maxLength={2000}
          className="mt-2 w-full resize-y rounded-xl border border-line bg-paper px-3 py-2 text-sm text-ink outline-none focus:border-accent"
        />
        <button
          type="button"
          onClick={generateDraft}
          disabled={drafting || nl.trim().length < 5}
          className="btn-ghost mt-2 gap-1.5 px-3 py-1.5 text-sm"
        >
          <Icon name="spark" width={14} height={14} />
          {drafting ? dict.automations.generating : dict.automations.generateDraft}
        </button>
        {draftReady && (
          <p className="mt-2 rounded-lg bg-accent-soft px-3 py-2 text-xs text-accent">{dict.automations.draftReady}</p>
        )}
      </section>

      {/* Core fields */}
      <section className="card mt-4 space-y-4 p-5">
        <Labeled label={dict.automations.nameLabel}>
          <input
            value={s.name}
            onChange={(e) => set('name', e.target.value)}
            placeholder={dict.automations.namePlaceholder}
            maxLength={160}
            className="w-full rounded-xl border border-line bg-paper px-3 py-2 text-sm text-ink outline-none focus:border-accent"
          />
        </Labeled>
        <Labeled label={dict.automations.goalLabel}>
          <textarea
            value={s.goal}
            onChange={(e) => set('goal', e.target.value)}
            placeholder={dict.automations.goalPlaceholder}
            rows={3}
            maxLength={8000}
            className="w-full resize-y rounded-xl border border-line bg-paper px-3 py-2 text-sm text-ink outline-none focus:border-accent"
          />
        </Labeled>

        <div>
          <p className="text-xs font-semibold text-ink-soft">{dict.automations.ownerType}</p>
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            <Choice active={s.ownerType === 'PERSONAL'} title={dict.automations.ownerPersonal} onClick={() => set('ownerType', 'PERSONAL')} />
            <Choice active={s.ownerType === 'ORGANIZATION'} title={dict.automations.ownerOrg} onClick={() => set('ownerType', 'ORGANIZATION')} />
          </div>
        </div>

        <div>
          <p className="text-xs font-semibold text-ink-soft">{dict.automations.agentMode}</p>
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            <Choice active={s.agentMode === 'ASSISTED'} title={dict.automations.modeAssisted} hint={dict.automations.modeAssistedHint} onClick={() => set('agentMode', 'ASSISTED')} />
            <Choice active={s.agentMode === 'AGENT'} title={dict.automations.modeAgent} hint={dict.automations.modeAgentHint} onClick={() => set('agentMode', 'AGENT')} />
          </div>
        </div>
      </section>

      {/* Trigger */}
      <section className="card mt-4 space-y-4 p-5">
        <p className="text-sm font-semibold text-ink">{dict.automations.trigger}</p>
        <div className="grid gap-2 sm:grid-cols-2">
          <Choice active={s.triggerType === 'MANUAL'} title={dict.automations.triggerManual} hint={dict.automations.triggerManualHint} onClick={() => set('triggerType', 'MANUAL')} />
          <Choice active={s.triggerType === 'SCHEDULE'} title={dict.automations.triggerSchedule} hint={dict.automations.triggerScheduleHint} onClick={() => set('triggerType', 'SCHEDULE')} />
        </div>

        {s.triggerType === 'SCHEDULE' && (
          <div className="space-y-3 rounded-xl border border-line p-4">
            <Labeled label={dict.automations.pattern}>
              <select
                value={s.pattern}
                onChange={(e) => set('pattern', e.target.value as Pattern)}
                className="w-full rounded-xl border border-line bg-paper px-3 py-2 text-sm text-ink outline-none focus:border-accent"
              >
                <option value="once">{dict.automations.patternOnce}</option>
                <option value="daily">{dict.automations.patternDaily}</option>
                <option value="weekly">{dict.automations.patternWeekly}</option>
                <option value="monthly">{dict.automations.patternMonthly}</option>
              </select>
            </Labeled>

            {s.pattern === 'once' ? (
              <Labeled label={dict.automations.dateTime}>
                <input
                  type="datetime-local"
                  value={s.at}
                  onChange={(e) => set('at', e.target.value)}
                  className="w-full rounded-xl border border-line bg-paper px-3 py-2 text-sm text-ink outline-none focus:border-accent"
                />
              </Labeled>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2">
                <Labeled label={dict.automations.time}>
                  <input
                    type="time"
                    value={s.time}
                    onChange={(e) => set('time', e.target.value)}
                    className="w-full rounded-xl border border-line bg-paper px-3 py-2 text-sm text-ink outline-none focus:border-accent"
                  />
                </Labeled>
                {s.pattern === 'weekly' && (
                  <Labeled label={dict.automations.weekday}>
                    <select
                      value={s.weekday}
                      onChange={(e) => set('weekday', Number(e.target.value))}
                      className="w-full rounded-xl border border-line bg-paper px-3 py-2 text-sm text-ink outline-none focus:border-accent"
                    >
                      {weekdayLabels.map((label, idx) => (
                        <option key={idx} value={idx}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </Labeled>
                )}
                {s.pattern === 'monthly' && (
                  <Labeled label={dict.automations.dayOfMonth}>
                    <input
                      type="number"
                      min={1}
                      max={31}
                      value={s.day}
                      onChange={(e) => set('day', Number(e.target.value))}
                      className="w-full rounded-xl border border-line bg-paper px-3 py-2 text-sm text-ink outline-none focus:border-accent"
                    />
                  </Labeled>
                )}
              </div>
            )}

            <Labeled label={dict.automations.timezone}>
              <select
                value={s.timezone}
                onChange={(e) => set('timezone', e.target.value)}
                className="w-full rounded-xl border border-line bg-paper px-3 py-2 text-sm text-ink outline-none focus:border-accent"
              >
                {tzOptions.map((tz) => (
                  <option key={tz} value={tz}>
                    {tz}
                  </option>
                ))}
              </select>
            </Labeled>
          </div>
        )}
      </section>

      {/* Approval + sources */}
      <section className="card mt-4 space-y-4 p-5">
        <Labeled label={dict.automations.approvalPolicy}>
          <select
            value={s.approvalPolicy}
            onChange={(e) => set('approvalPolicy', e.target.value as ApprovalPolicy)}
            className="w-full rounded-xl border border-line bg-paper px-3 py-2 text-sm text-ink outline-none focus:border-accent"
          >
            <option value="ASK_EVERY_WRITE">{dict.automations.policyEveryWrite}</option>
            <option value="ASK_HIGH_RISK_ONLY">{dict.automations.policyHighRisk}</option>
            <option value="READ_ONLY_AUTOMATIC">{dict.automations.policyReadOnly}</option>
          </select>
        </Labeled>

        <p className="text-sm font-semibold text-ink">{dict.automations.sources}</p>
        <Labeled label={dict.automations.knowledgeBases} hint={dict.automations.knowledgeBasesHint}>
          <input
            value={s.knowledgeBaseIds}
            onChange={(e) => set('knowledgeBaseIds', e.target.value)}
            className="w-full rounded-xl border border-line bg-paper px-3 py-2 text-sm text-ink outline-none focus:border-accent"
          />
        </Labeled>
        <Labeled label={dict.automations.connections} hint={dict.automations.connectionsHint}>
          <input
            value={s.connectionIds}
            onChange={(e) => set('connectionIds', e.target.value)}
            className="w-full rounded-xl border border-line bg-paper px-3 py-2 text-sm text-ink outline-none focus:border-accent"
          />
        </Labeled>
        <label className="flex items-start gap-2.5">
          <input
            type="checkbox"
            checked={s.webSearchEnabled}
            onChange={(e) => set('webSearchEnabled', e.target.checked)}
            className="mt-0.5 h-4 w-4 accent-accent"
          />
          <span>
            <span className="block text-sm font-medium text-ink">{dict.automations.webSearch}</span>
            <span className="block text-xs text-ink-faint">{dict.automations.webSearchHint}</span>
          </span>
        </label>
      </section>

      {/* Limits + notifications */}
      <section className="card mt-4 space-y-4 p-5">
        <p className="text-sm font-semibold text-ink">{dict.automations.limits}</p>
        <div className="grid gap-3 sm:grid-cols-3">
          <Labeled label={dict.automations.maxSteps}>
            <input
              type="number"
              min={1}
              max={20}
              value={s.maxSteps}
              onChange={(e) => set('maxSteps', e.target.value)}
              className="w-full rounded-xl border border-line bg-paper px-3 py-2 text-sm text-ink outline-none focus:border-accent"
            />
          </Labeled>
          <Labeled label={dict.automations.maxWrites}>
            <input
              type="number"
              min={0}
              max={5}
              value={s.maxWritesPerRun}
              onChange={(e) => set('maxWritesPerRun', e.target.value)}
              className="w-full rounded-xl border border-line bg-paper px-3 py-2 text-sm text-ink outline-none focus:border-accent"
            />
          </Labeled>
          <Labeled label={dict.automations.maxRunsMonth}>
            <input
              type="number"
              min={1}
              max={3000}
              value={s.maxRunsPerMonth}
              onChange={(e) => set('maxRunsPerMonth', e.target.value)}
              className="w-full rounded-xl border border-line bg-paper px-3 py-2 text-sm text-ink outline-none focus:border-accent"
            />
          </Labeled>
        </div>

        <p className="text-sm font-semibold text-ink">{dict.automations.notifications}</p>
        <Labeled label={dict.automations.notifySuccess}>
          <select
            value={s.notifyOnSuccess}
            onChange={(e) => set('notifyOnSuccess', e.target.value as BuilderState['notifyOnSuccess'])}
            className="w-full rounded-xl border border-line bg-paper px-3 py-2 text-sm text-ink outline-none focus:border-accent"
          >
            <option value="NEVER">{dict.automations.notifyNever}</option>
            <option value="MEANINGFUL">{dict.automations.notifyMeaningful}</option>
            <option value="EVERY">{dict.automations.notifyEvery}</option>
          </select>
        </Labeled>
        <label className="flex items-center gap-2.5">
          <input
            type="checkbox"
            checked={s.notifyOnFailure}
            onChange={(e) => set('notifyOnFailure', e.target.checked)}
            className="h-4 w-4 accent-accent"
          />
          <span className="text-sm font-medium text-ink">{dict.automations.notifyFailure}</span>
        </label>
      </section>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <button onClick={submit} disabled={!canSubmit} className="btn-primary px-4 py-2 text-sm">
          {submitting ? dict.automations.creating : dict.automations.create}
        </button>
        <button onClick={onCancel} className="btn-ghost px-3 py-2 text-sm">
          {dict.common.cancel}
        </button>
      </div>
      <p className="mt-2 text-xs text-ink-faint">{dict.automations.createHint}</p>
    </>
  );
}

function Labeled({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="text-sm font-medium text-ink">{label}</span>
      {hint && <span className="mt-0.5 block text-xs text-ink-faint">{hint}</span>}
      <span className="mt-1.5 block">{children}</span>
    </label>
  );
}

function Choice({
  active,
  title,
  hint,
  onClick,
}: {
  active: boolean;
  title: string;
  hint?: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`rounded-xl border px-3 py-2.5 text-start transition-colors ${
        active ? 'border-accent bg-accent-soft' : 'border-line hover:border-line-strong'
      }`}
    >
      <span className={`block text-sm font-semibold ${active ? 'text-accent' : 'text-ink'}`}>{title}</span>
      {hint && <span className="mt-0.5 block text-xs text-ink-soft">{hint}</span>}
    </button>
  );
}

function BackHeader({ title, onBack, backLabel }: { title: string; onBack: () => void; backLabel: string }) {
  return (
    <div className="flex items-center gap-2">
      <button type="button" onClick={onBack} className="btn-ghost -ms-2 gap-1 p-2 text-sm">
        <span className="ltr:inline rtl:hidden">&larr;</span>
        <span className="ltr:hidden rtl:inline">&rarr;</span>
        {backLabel}
      </button>
    </div>
  );
}

// ---- Detail ----

interface ActivationSummary {
  schedule: string;
  access: string[];
  externalWrites: string;
  maxRunsPerMonth: number | null;
  approvalPolicy: string;
}

interface WorkflowDetailData {
  workflow: {
    id: string;
    name: string;
    description: string | null;
    goal: string;
    status: WorkflowStatus;
    triggerType: string;
    approvalPolicy: string;
    timezone: string;
    nextRunAt: string | null;
    lastRunAt: string | null;
  };
  trigger: { type: string; schedule: unknown; timezone: string | null; checkIntervalMinutes: number | null } | null;
  activationSummary: ActivationSummary;
  canManage: boolean;
  runs: Array<{
    id: string;
    status: RunStatus;
    trigger: string;
    writeActions: number;
    createdAt: string;
    completedAt: string | null;
    resultSummary: string | null;
  }>;
  standingAuthorizations: Array<{
    id: string;
    toolId: string;
    destinations: string[];
    status: string;
    expiresAt: string | null;
    executionsUsed: number;
    maxExecutions: number | null;
  }>;
}

interface RunStep {
  index: number;
  type: string;
  toolId: string | null;
  status: string;
  output: string | null;
}

interface PreviewField {
  label: string;
  value: string;
}
interface ActionPreview {
  title: string;
  description: string;
  riskLevel: string;
  reversibility: string;
  affectedResources: string[];
  recipient?: string;
  destination?: string;
  contentPreview?: string;
  fields?: PreviewField[];
}
interface PendingApproval {
  id: string;
  toolId: string;
  riskLevel: string;
  expiresAt: string;
  preview: ActionPreview;
}
interface RunDetailData {
  run: {
    id: string;
    status: RunStatus;
    trigger: string;
    dryRun: boolean;
    stepsExecuted: number;
    writeActions: number;
    estimatedCost: number;
    errorCode: string | null;
    resultSummary: string | null;
    startedAt: string | null;
    completedAt: string | null;
  };
  steps: RunStep[];
  pendingApproval: PendingApproval | null;
}

function WorkflowDetail({
  locale,
  dict,
  id,
  justCreated,
  onBack,
}: {
  locale: Locale;
  dict: Dictionary;
  id: string;
  justCreated?: boolean;
  onBack: () => void;
}) {
  const [data, setData] = useState<WorkflowDetailData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [banner, setBanner] = useState<string | null>(null);
  const [selectedRun, setSelectedRun] = useState<RunDetailData | null>(null);
  const [runBusy, setRunBusy] = useState(false);

  const fmtCost = new Intl.NumberFormat(locale === 'ar' ? 'ar-AE' : 'en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 4,
  });

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/workflows/${id}`, { cache: 'no-store' });
      if (!res.ok) {
        setError(dict.common.somethingWrong);
        return;
      }
      setData(await res.json());
    } catch {
      setError(dict.common.somethingWrong);
    }
  }, [id, dict]);

  useEffect(() => {
    void load();
  }, [load]);

  async function lifecycle(path: 'activate' | 'pause' | 'resume') {
    setBusy(true);
    setError(null);
    setBanner(null);
    try {
      const res = await fetch(`/api/workflows/${id}/${path}`, { method: 'POST' });
      const body = await res.json().catch(() => null);
      if (!res.ok || (body && body.ok === false)) {
        setError((body && body.error) || dict.common.somethingWrong);
        return;
      }
      if (path === 'activate') setBanner(dict.automations.activated);
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function run(dryRun: boolean) {
    setRunBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/workflows/${id}/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dryRun }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok || !body || body.ok !== true) {
        setError((body && body.error) || dict.common.somethingWrong);
        return;
      }
      await load();
      if (body.runId) await openRun(body.runId);
    } finally {
      setRunBusy(false);
    }
  }

  const openRun = useCallback(async (runId: string) => {
    try {
      const res = await fetch(`/api/workflows/runs/${runId}`, { cache: 'no-store' });
      if (!res.ok) return;
      setSelectedRun(await res.json());
    } catch {
      /* non-fatal */
    }
  }, []);

  async function decide(runId: string, approvalId: string, decision: 'APPROVED' | 'REJECTED') {
    setRunBusy(true);
    try {
      await fetch(`/api/workflows/runs/${runId}/approve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ approvalId, decision }),
      });
      await openRun(runId);
      await load();
    } finally {
      setRunBusy(false);
    }
  }

  async function revoke(authId: string) {
    setBusy(true);
    try {
      await fetch(`/api/workflows/standing-auth/${authId}`, { method: 'DELETE' });
      await load();
    } finally {
      setBusy(false);
    }
  }

  if (!data) {
    return (
      <>
        <BackHeader title={dict.automations.title} onBack={onBack} backLabel={dict.automations.back} />
        {error ? <p className="mt-6 text-sm text-danger">{error}</p> : <Loading />}
      </>
    );
  }

  const w = data.workflow;
  const summary = data.activationSummary;

  return (
    <>
      <BackHeader title={w.name} onBack={onBack} backLabel={dict.automations.back} />

      <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold tracking-tight text-ink">{w.name}</h1>
          {w.description && <p className="mt-1 text-sm text-ink-soft">{w.description}</p>}
        </div>
        <WfStatusBadge status={w.status} dict={dict} />
      </div>

      {error && (
        <p role="alert" className="mt-4 rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger">
          {error}
        </p>
      )}
      {banner && <p className="mt-4 rounded-lg bg-success/15 px-3 py-2 text-sm text-success">{banner}</p>}

      {/* Activation review */}
      <section className={`card mt-6 p-5 ${justCreated && w.status === 'DRAFT' ? 'border-accent/50' : ''}`}>
        <h2 className="text-sm font-semibold text-ink">{dict.automations.activationTitle}</h2>
        <p className="mt-1 text-xs text-ink-soft">{dict.automations.activationIntro}</p>
        <dl className="mt-3 grid gap-2 text-xs sm:grid-cols-2">
          <SummaryRow label={dict.automations.summarySchedule} value={summary.schedule} />
          <SummaryRow label={dict.automations.summaryExternalWrites} value={summary.externalWrites} />
          <SummaryRow
            label={dict.automations.summaryMaxRuns}
            value={summary.maxRunsPerMonth == null ? '—' : String(summary.maxRunsPerMonth)}
          />
          <SummaryRow label={dict.automations.summaryApproval} value={summary.approvalPolicy} />
          <SummaryRow
            label={dict.automations.summaryAccess}
            value={summary.access.length ? summary.access.join(', ') : '—'}
          />
          <SummaryRow label={dict.automations.nextRun} value={fmtInTz(w.nextRunAt, w.timezone, locale)} />
        </dl>

        {data.canManage && (
          <div className="mt-4 flex flex-wrap items-center gap-2">
            {w.status === 'DRAFT' && (
              <button onClick={() => lifecycle('activate')} disabled={busy} className="btn-primary px-4 py-2 text-sm">
                {busy ? dict.automations.activating : dict.automations.activate}
              </button>
            )}
            {w.status === 'ACTIVE' && (
              <button onClick={() => lifecycle('pause')} disabled={busy} className="btn-ghost px-3 py-2 text-sm">
                {dict.automations.pause}
              </button>
            )}
            {(w.status === 'PAUSED' || w.status === 'AUTO_PAUSED') && (
              <button onClick={() => lifecycle('resume')} disabled={busy} className="btn-ghost px-3 py-2 text-sm">
                {dict.automations.resume}
              </button>
            )}
            <button onClick={() => run(false)} disabled={runBusy} className="btn-ghost px-3 py-2 text-sm">
              {dict.automations.runNow}
            </button>
            <button onClick={() => run(true)} disabled={runBusy} className="btn-ghost px-3 py-2 text-sm">
              {dict.automations.testRun}
            </button>
          </div>
        )}
        <p className="mt-2 text-xs text-ink-faint">{dict.automations.testRunHint}</p>
      </section>

      {/* Selected run detail */}
      {selectedRun && (
        <section className="card mt-4 border-accent/40 p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-semibold text-ink">{dict.automations.result}</h2>
            <div className="flex items-center gap-2">
              {selectedRun.run.dryRun && (
                <span className="rounded-full bg-paper-sunken px-2.5 py-0.5 text-xs font-medium text-ink-soft">
                  {dict.automations.dryRunBadge}
                </span>
              )}
              <RunStatusBadge status={selectedRun.run.status} dict={dict} />
              <button onClick={() => setSelectedRun(null)} className="btn-ghost p-1" aria-label={dict.common.cancel}>
                <Icon name="close" width={14} height={14} />
              </button>
            </div>
          </div>

          {selectedRun.run.resultSummary && (
            <p className="mt-3 whitespace-pre-wrap text-sm text-ink">{selectedRun.run.resultSummary}</p>
          )}

          <dl className="mt-3 grid gap-2 text-xs sm:grid-cols-3">
            <SummaryRow label={dict.automations.steps} value={String(selectedRun.run.stepsExecuted)} />
            <SummaryRow label={dict.automations.writeActions} value={String(selectedRun.run.writeActions)} />
            <SummaryRow
              label={`${dict.automations.estimatedCost} (${dict.automations.estimate})`}
              value={fmtCost.format(selectedRun.run.estimatedCost ?? 0)}
            />
          </dl>

          {/* Pending approval */}
          {selectedRun.run.status === 'AWAITING_APPROVAL' && selectedRun.pendingApproval && (
            <ApprovalCard
              dict={dict}
              locale={locale}
              approval={selectedRun.pendingApproval}
              busy={runBusy}
              onApprove={() => decide(selectedRun.run.id, selectedRun.pendingApproval!.id, 'APPROVED')}
              onReject={() => decide(selectedRun.run.id, selectedRun.pendingApproval!.id, 'REJECTED')}
            />
          )}

          {/* Steps */}
          <div className="mt-4">
            <p className="text-xs font-semibold text-ink-soft">{dict.automations.runSteps}</p>
            {selectedRun.steps.length === 0 ? (
              <p className="mt-2 text-sm text-ink-faint">{dict.automations.runStepsEmpty}</p>
            ) : (
              <ul className="mt-2 space-y-2">
                {selectedRun.steps.map((step) => (
                  <li key={step.index} className="rounded-xl border border-line px-3 py-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-xs font-semibold text-ink">{step.index + 1}</span>
                      <span className="text-xs text-ink-soft">{step.type}</span>
                      {step.toolId && (
                        <code className="rounded bg-paper-sunken px-1.5 py-0.5 text-[11px] text-ink-soft">
                          {step.toolId}
                        </code>
                      )}
                      <span className="ms-auto text-[11px] uppercase tracking-wide text-ink-faint">{step.status}</span>
                    </div>
                    {step.output && <p className="mt-1.5 whitespace-pre-wrap text-xs text-ink-soft">{step.output}</p>}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>
      )}

      {/* Run history */}
      <section className="card mt-4 p-5">
        <h2 className="text-sm font-semibold text-ink">{dict.automations.runHistory}</h2>
        {data.runs.length === 0 ? (
          <p className="mt-3 text-sm text-ink-faint">{dict.automations.emptyHistory}</p>
        ) : (
          <ul className="mt-3 space-y-2">
            {data.runs.map((r) => (
              <li key={r.id}>
                <button
                  onClick={() => openRun(r.id)}
                  className="flex w-full items-center justify-between gap-3 rounded-xl border border-line px-3 py-2 text-start transition-colors hover:border-accent"
                >
                  <span className="min-w-0">
                    <span className="block truncate text-sm text-ink-soft">
                      {r.resultSummary || `${dict.automations.triggerLabel}: ${r.trigger}`}
                    </span>
                    <span className="mt-0.5 block text-[11px] text-ink-faint">
                      {fmtInTz(r.createdAt, w.timezone, locale)}
                    </span>
                  </span>
                  <RunStatusBadge status={r.status} dict={dict} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Standing authorizations */}
      <section className="card mt-4 p-5">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-ink">
          <Icon name="shield" width={16} height={16} />
          {dict.automations.standingAuth}
        </h2>
        {data.standingAuthorizations.length === 0 ? (
          <p className="mt-3 text-sm text-ink-faint">{dict.automations.standingAuthEmpty}</p>
        ) : (
          <ul className="mt-3 space-y-2">
            {data.standingAuthorizations.map((a) => (
              <li key={a.id} className="rounded-xl border border-line px-3 py-2.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <code className="rounded bg-paper-sunken px-1.5 py-0.5 text-[11px] text-ink-soft">{a.toolId}</code>
                  {data.canManage && (
                    <button
                      onClick={() => revoke(a.id)}
                      disabled={busy}
                      className="btn-ghost px-2.5 py-1 text-xs text-danger"
                    >
                      {dict.automations.revoke}
                    </button>
                  )}
                </div>
                <p className="mt-1.5 text-xs text-ink-soft">
                  {dict.automations.destinations}: {a.destinations.join(', ') || '—'}
                </p>
                <p className="mt-0.5 text-[11px] text-ink-faint">
                  {dict.automations.executions}: {a.executionsUsed}
                  {a.maxExecutions != null ? ` / ${a.maxExecutions}` : ''}
                  {a.expiresAt ? ` · ${dict.automations.expires}: ${fmtInTz(a.expiresAt, w.timezone, locale)}` : ''}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Goal / instructions (no reasoning, just the configured goal) */}
      <section className="card mt-4 p-5">
        <h2 className="text-sm font-semibold text-ink">{dict.automations.goalLabel}</h2>
        <p className="mt-2 whitespace-pre-wrap text-sm text-ink-soft">{w.goal}</p>
      </section>
    </>
  );
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-line px-3 py-2">
      <dt className="text-ink-faint">{label}</dt>
      <dd className="mt-0.5 font-medium text-ink">{value}</dd>
    </div>
  );
}

function ApprovalCard({
  dict,
  locale,
  approval,
  busy,
  onApprove,
  onReject,
}: {
  dict: Dictionary;
  locale: Locale;
  approval: PendingApproval;
  busy: boolean;
  onApprove: () => void;
  onReject: () => void;
}) {
  const p = approval.preview;
  return (
    <div className="mt-4 rounded-xl border border-gold/40 bg-gold/5 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-ink">
          <Icon name="shield" width={16} height={16} />
          {dict.automations.approvalNeeded}
        </h3>
        <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${riskClass(p.riskLevel)}`}>
          {riskLabel(p.riskLevel, dict)}
        </span>
      </div>
      <p className="mt-2 text-xs text-ink-soft">{dict.automations.approvalIntro}</p>
      <p className="mt-2 text-sm font-semibold text-ink">{p.title}</p>
      {p.description && <p className="mt-1 text-sm text-ink-soft">{p.description}</p>}

      <dl className="mt-3 grid gap-2 text-xs sm:grid-cols-2">
        {p.recipient != null && <SummaryRow label={dict.agent.recipient} value={p.recipient || '—'} />}
        {p.destination != null && <SummaryRow label={dict.agent.destination} value={p.destination || '—'} />}
        {p.affectedResources.length > 0 && (
          <SummaryRow label={dict.agent.affectedResources} value={p.affectedResources.join(', ')} />
        )}
        <SummaryRow label={dict.agent.reversibility} value={p.reversibility} />
      </dl>

      {p.contentPreview != null && (
        <div className="mt-3">
          <p className="text-xs font-semibold text-ink-soft">{dict.agent.content}</p>
          <p className="mt-1 whitespace-pre-wrap rounded-xl border border-line bg-paper-sunken px-3 py-2 text-sm text-ink-soft">
            {p.contentPreview}
          </p>
        </div>
      )}

      <p className="mt-3 text-xs text-ink-faint">
        {dict.agent.expires}: {fmtInTz(approval.expiresAt, DEFAULT_TZ, locale)}
      </p>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button onClick={onApprove} disabled={busy} className="btn-primary px-3 py-1.5 text-xs">
          {busy ? dict.automations.working : dict.automations.approve}
        </button>
        <button onClick={onReject} disabled={busy} className="btn-ghost px-3 py-1.5 text-xs text-danger">
          {dict.automations.reject}
        </button>
      </div>
    </div>
  );
}
