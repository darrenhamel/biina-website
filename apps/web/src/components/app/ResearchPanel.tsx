'use client';

import { useCallback, useEffect, useState } from 'react';
import type { Locale } from '@/i18n/config';
import type { Dictionary } from '@/i18n/dictionaries';
import { Icon } from '@/components/Icon';

// ---- Types (mirror the API shapes; UI-only) ----

type ResearchStatus =
  | 'PLANNING'
  | 'RUNNING'
  | 'SYNTHESIZING'
  | 'AWAITING_APPROVAL'
  | 'COMPLETED'
  | 'PARTIALLY_COMPLETED'
  | 'FAILED'
  | 'CANCELED'
  | 'BLOCKED';

type Depth = 'QUICK' | 'STANDARD' | 'DEEP';

type FindingStatus = 'SUPPORTED' | 'PARTIALLY_SUPPORTED' | 'CONFLICTING' | 'UNVERIFIED';

const ACTIVE_STATUSES: ResearchStatus[] = ['PLANNING', 'RUNNING', 'SYNTHESIZING', 'AWAITING_APPROVAL'];

interface HistoryItem {
  id: string;
  objective: string;
  status: ResearchStatus;
  depth: Depth;
  sourcesCollected: number;
  tasksCompleted: number;
  createdAt: string;
  completedAt: string | null;
}

interface TemplateItem {
  slug: string;
  name: string;
  objective: string;
  depth: Depth;
}

interface DetailTask {
  id: string;
  title: string;
  type: string;
  profile: string;
  status: string;
  scope: string | null;
}

interface DetailSource {
  id: string;
  title: string;
  sourceType: string;
  reference: string | null;
  retrievedAt: string | null;
  publishedAt: string | null;
  quality: Record<string, unknown> | null;
}

interface Finding {
  id?: string;
  claim: string;
  confidence: unknown;
  status: FindingStatus | string;
  citationIds: string[];
}

interface Conflict {
  id: string;
  topic: string;
  status: string;
}

interface ResearchResult {
  executiveSummary: string;
  findings: Finding[];
  analysis: string;
  uncertainties: string[];
  citationIds: string[];
  partial: boolean;
}

interface DetailData {
  session: {
    id: string;
    objective: string;
    status: ResearchStatus;
    depth: Depth;
    plan: { questions: string[]; areas: string[] };
    tasksCreated: number;
    tasksCompleted: number;
    sourcesCollected: number;
    agentRunsUsed: number;
    estimatedCost: number;
    createdAt: string;
    completedAt: string | null;
  };
  tasks: DetailTask[];
  sources: DetailSource[];
  findings: Finding[];
  conflicts: Conflict[];
  result: ResearchResult | null;
}

type View = { kind: 'hub' } | { kind: 'detail'; id: string };

// ---- Label + colour helpers ----

function statusLabel(status: string, dict: Dictionary): string {
  const map: Record<string, string> = {
    PLANNING: dict.research.statusPlanning,
    RUNNING: dict.research.statusRunning,
    SYNTHESIZING: dict.research.statusSynthesizing,
    AWAITING_APPROVAL: dict.research.statusAwaitingApproval,
    COMPLETED: dict.research.statusCompleted,
    PARTIALLY_COMPLETED: dict.research.statusPartial,
    FAILED: dict.research.statusFailed,
    CANCELED: dict.research.statusCanceled,
    BLOCKED: dict.research.statusBlocked,
  };
  return map[status] ?? status;
}

function statusClass(status: string): string {
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
    case 'PLANNING':
    case 'SYNTHESIZING':
      return 'bg-accent-soft text-accent';
    default:
      return 'bg-paper-sunken text-ink-soft';
  }
}

function depthLabel(depth: string, dict: Dictionary): string {
  const map: Record<string, string> = {
    QUICK: dict.research.depthQuick,
    STANDARD: dict.research.depthStandard,
    DEEP: dict.research.depthDeep,
  };
  return map[depth] ?? depth;
}

function taskStatusLabel(status: string, dict: Dictionary): string {
  const map: Record<string, string> = {
    PENDING: dict.research.taskPending,
    RUNNING: dict.research.taskRunning,
    IN_PROGRESS: dict.research.taskRunning,
    COMPLETED: dict.research.taskCompleted,
    DONE: dict.research.taskCompleted,
    FAILED: dict.research.taskFailed,
    BLOCKED: dict.research.taskBlocked,
    SKIPPED: dict.research.taskSkipped,
    CANCELED: dict.research.taskCanceled,
  };
  return map[status] ?? status;
}

function taskStatusClass(status: string): string {
  switch (status) {
    case 'COMPLETED':
    case 'DONE':
      return 'bg-success/15 text-success';
    case 'FAILED':
    case 'BLOCKED':
      return 'bg-danger/10 text-danger';
    case 'RUNNING':
    case 'IN_PROGRESS':
      return 'bg-accent-soft text-accent';
    default:
      return 'bg-paper-sunken text-ink-soft';
  }
}

function findingStatusLabel(status: string, dict: Dictionary): string {
  const map: Record<string, string> = {
    SUPPORTED: dict.research.findingSupported,
    PARTIALLY_SUPPORTED: dict.research.findingPartial,
    CONFLICTING: dict.research.findingConflicting,
    UNVERIFIED: dict.research.findingUnverified,
  };
  return map[status] ?? status;
}

function findingStatusClass(status: string): string {
  switch (status) {
    case 'SUPPORTED':
      return 'bg-success/15 text-success';
    case 'CONFLICTING':
      return 'bg-danger/10 text-danger';
    case 'PARTIALLY_SUPPORTED':
      return 'bg-gold/15 text-gold';
    default:
      return 'bg-paper-sunken text-ink-soft';
  }
}

function confidenceLabel(value: unknown, dict: Dictionary): string {
  if (value == null) return '';
  if (typeof value === 'number') {
    if (value >= 0.66) return dict.research.confHigh;
    if (value >= 0.33) return dict.research.confMedium;
    return dict.research.confLow;
  }
  const s = String(value).toUpperCase();
  if (s === 'HIGH') return dict.research.confHigh;
  if (s === 'MEDIUM' || s === 'MED') return dict.research.confMedium;
  if (s === 'LOW') return dict.research.confLow;
  return String(value);
}

function sourceTypeLabel(type: string, dict: Dictionary): string {
  if (type === 'PUBLIC_WEB') return dict.research.srcPublicWeb;
  if (type === 'PRIMARY_OFFICIAL_SOURCE') return dict.research.srcPrimaryOfficial;
  if (type === 'KNOWLEDGE_BASE') return dict.research.srcKnowledgeBase;
  if (type === 'PRIVATE_DOCUMENT') return dict.research.srcPrivateDocument;
  if (type === 'MULTIMODAL_SOURCE') return dict.research.srcMultimodal;
  if (type.startsWith('CONNECTED_')) return dict.research.srcConnected;
  return dict.research.srcOther;
}

function sourceTypeClass(type: string): string {
  if (type === 'PRIMARY_OFFICIAL_SOURCE') return 'bg-success/15 text-success';
  if (type === 'PUBLIC_WEB') return 'bg-accent-soft text-accent';
  if (type === 'PRIVATE_DOCUMENT' || type.startsWith('CONNECTED_') || type === 'KNOWLEDGE_BASE')
    return 'bg-gold/15 text-gold';
  return 'bg-paper-sunken text-ink-soft';
}

function isPrivateSource(type: string): boolean {
  return type === 'PRIVATE_DOCUMENT' || type === 'KNOWLEDGE_BASE' || type.startsWith('CONNECTED_');
}

function isHttpUrl(ref: string | null): boolean {
  return !!ref && /^https?:\/\//i.test(ref);
}

function progressLabel(status: ResearchStatus, dict: Dictionary): string {
  switch (status) {
    case 'PLANNING':
      return dict.research.progressPlanning;
    case 'RUNNING':
      return dict.research.progressResearching;
    case 'AWAITING_APPROVAL':
      return dict.research.progressVerifying;
    case 'SYNTHESIZING':
      return dict.research.progressSynthesizing;
    default:
      return '';
  }
}

function StatusBadge({ status, dict }: { status: string; dict: Dictionary }) {
  return (
    <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${statusClass(status)}`}>
      {statusLabel(status, dict)}
    </span>
  );
}

function parseIds(s: string): string[] {
  return s
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean);
}

// ---- Root ----

export function ResearchPanel({ locale, dict }: { locale: Locale; dict: Dictionary }) {
  const [view, setView] = useState<View>({ kind: 'hub' });

  return (
    <div className="scroll-slim h-full overflow-y-auto">
      <div className="mx-auto max-w-3xl px-5 py-8">
        {view.kind === 'hub' && (
          <Hub locale={locale} dict={dict} onOpen={(id) => setView({ kind: 'detail', id })} />
        )}
        {view.kind === 'detail' && (
          <Detail locale={locale} dict={dict} id={view.id} onBack={() => setView({ kind: 'hub' })} />
        )}
      </div>
    </div>
  );
}

// ---- Hub: new research + templates + history ----

function Hub({
  locale,
  dict,
  onOpen,
}: {
  locale: Locale;
  dict: Dictionary;
  onOpen: (id: string) => void;
}) {
  const [objective, setObjective] = useState('');
  const [depth, setDepth] = useState<Depth>('STANDARD');
  const [webEnabled, setWebEnabled] = useState(true);
  const [kbIds, setKbIds] = useState('');
  const [connIds, setConnIds] = useState('');
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [templates, setTemplates] = useState<TemplateItem[] | null>(null);
  const [history, setHistory] = useState<HistoryItem[] | null>(null);

  const fmtDate = new Intl.DateTimeFormat(locale === 'ar' ? 'ar-AE' : 'en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
  });

  const loadTemplates = useCallback(async () => {
    try {
      const res = await fetch('/api/research/templates', { cache: 'no-store' });
      if (!res.ok) throw new Error();
      const body = await res.json();
      setTemplates(Array.isArray(body.templates) ? body.templates : []);
    } catch {
      setTemplates([]);
    }
  }, []);

  const loadHistory = useCallback(async () => {
    try {
      const res = await fetch('/api/research', { cache: 'no-store' });
      if (res.status === 403) {
        setHistory([]);
        return;
      }
      if (!res.ok) throw new Error();
      const body = await res.json();
      setHistory(Array.isArray(body.sessions) ? body.sessions : []);
    } catch {
      setHistory([]);
    }
  }, []);

  useEffect(() => {
    void loadTemplates();
    void loadHistory();
  }, [loadTemplates, loadHistory]);

  function applyTemplate(t: TemplateItem) {
    const topic = objective.trim();
    const filled = topic
      ? t.objective.replace(/\{topic\}/g, topic).replace(/\{vendor\}/g, topic)
      : t.objective;
    setObjective(filled);
    setDepth(t.depth);
    setError(null);
    if (typeof window !== 'undefined') window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  async function start() {
    const trimmed = objective.trim();
    if (trimmed.length < 5) return;
    setStarting(true);
    setError(null);
    try {
      const body: Record<string, unknown> = {
        objective: trimmed,
        depth,
        webEnabled,
        autoStart: depth !== 'DEEP',
      };
      const kb = parseIds(kbIds);
      if (kb.length) body.knowledgeBaseIds = kb;
      const conn = parseIds(connIds);
      if (conn.length) body.connectionIds = conn;

      const res = await fetch('/api/research', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (res.status === 403) {
        setError(dict.research.unavailable);
        return;
      }
      if (res.status === 429) {
        setError(dict.research.rateLimited);
        return;
      }
      const data = await res.json().catch(() => null);
      if (!res.ok || !data || !data.sessionId) {
        setError((data && data.error) || dict.common.somethingWrong);
        return;
      }
      onOpen(data.sessionId);
    } catch {
      setError(dict.common.somethingWrong);
    } finally {
      setStarting(false);
    }
  }

  const canStart = objective.trim().length >= 5 && !starting;

  return (
    <>
      <h1 className="text-2xl font-bold tracking-tight text-ink">{dict.research.title}</h1>
      <p className="mt-1 text-sm text-ink-soft">{dict.research.subtitle}</p>

      {error && (
        <p role="alert" className="mt-4 rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger">
          {error}
        </p>
      )}

      {/* New research */}
      <section className="card mt-6 p-5">
        <label htmlFor="research-objective" className="text-sm font-semibold text-ink">
          {dict.research.objectiveLabel}
        </label>
        <textarea
          id="research-objective"
          value={objective}
          onChange={(e) => setObjective(e.target.value)}
          placeholder={dict.research.objectivePlaceholder}
          rows={3}
          maxLength={4000}
          dir="auto"
          className="mt-2 w-full resize-y rounded-xl border border-line bg-paper px-3 py-2 text-sm text-ink outline-none focus:border-accent"
        />

        <div className="mt-4">
          <p className="text-xs font-semibold text-ink-soft">{dict.research.depth}</p>
          <div className="mt-2 grid gap-2 sm:grid-cols-3">
            <Choice
              active={depth === 'QUICK'}
              title={dict.research.depthQuick}
              hint={dict.research.depthQuickHint}
              onClick={() => setDepth('QUICK')}
            />
            <Choice
              active={depth === 'STANDARD'}
              title={dict.research.depthStandard}
              hint={dict.research.depthStandardHint}
              onClick={() => setDepth('STANDARD')}
            />
            <Choice
              active={depth === 'DEEP'}
              title={dict.research.depthDeep}
              hint={dict.research.depthDeepHint}
              onClick={() => setDepth('DEEP')}
            />
          </div>
        </div>

        <p className="mt-4 text-xs font-semibold text-ink-soft">{dict.research.sources}</p>
        <label className="mt-2 flex items-start gap-2.5">
          <input
            type="checkbox"
            checked={webEnabled}
            onChange={(e) => setWebEnabled(e.target.checked)}
            className="mt-0.5 h-4 w-4 accent-accent"
          />
          <span>
            <span className="block text-sm font-medium text-ink">{dict.research.webEnabled}</span>
            <span className="block text-xs text-ink-faint">{dict.research.webEnabledHint}</span>
          </span>
        </label>

        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="text-sm font-medium text-ink">{dict.research.knowledgeBases}</span>
            <span className="mt-0.5 block text-xs text-ink-faint">{dict.research.knowledgeBasesHint}</span>
            <input
              value={kbIds}
              onChange={(e) => setKbIds(e.target.value)}
              className="mt-1.5 w-full rounded-xl border border-line bg-paper px-3 py-2 text-sm text-ink outline-none focus:border-accent"
            />
          </label>
          <label className="block">
            <span className="text-sm font-medium text-ink">{dict.research.connections}</span>
            <span className="mt-0.5 block text-xs text-ink-faint">{dict.research.connectionsHint}</span>
            <input
              value={connIds}
              onChange={(e) => setConnIds(e.target.value)}
              className="mt-1.5 w-full rounded-xl border border-line bg-paper px-3 py-2 text-sm text-ink outline-none focus:border-accent"
            />
          </label>
        </div>

        <div className="mt-4">
          <button onClick={start} disabled={!canStart} className="btn-primary gap-1.5 px-4 py-2 text-sm">
            <Icon name="research" width={16} height={16} />
            {starting ? dict.research.starting : dict.research.start}
          </button>
        </div>
      </section>

      {/* Templates */}
      <section className="mt-8">
        <h2 className="text-sm font-semibold text-ink-soft">{dict.research.templates}</h2>
        {templates === null ? (
          <Loading />
        ) : templates.length === 0 ? (
          <p className="mt-3 text-sm text-ink-faint">{dict.research.templatesEmpty}</p>
        ) : (
          <div className="mt-3 space-y-2">
            {templates.map((t) => (
              <div key={t.slug} className="card flex flex-wrap items-start justify-between gap-2 p-4">
                <div className="min-w-0">
                  <p className="font-semibold text-ink" dir="auto">
                    {t.name}
                  </p>
                  <p className="mt-0.5 text-sm text-ink-soft" dir="auto">
                    {t.objective}
                  </p>
                  <span className="mt-1.5 inline-block rounded-full bg-paper-sunken px-2 py-0.5 text-[11px] font-medium text-ink-soft">
                    {depthLabel(t.depth, dict)}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => applyTemplate(t)}
                  className="btn-primary px-3 py-1.5 text-xs"
                >
                  {dict.research.useTemplate}
                </button>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* History */}
      <section className="mt-8">
        <h2 className="text-sm font-semibold text-ink-soft">{dict.research.history}</h2>
        {history === null ? (
          <Loading />
        ) : history.length === 0 ? (
          <p className="mt-3 text-sm text-ink-faint">{dict.research.historyEmpty}</p>
        ) : (
          <ul className="mt-3 space-y-2">
            {history.map((h) => (
              <li key={h.id}>
                <button
                  onClick={() => onOpen(h.id)}
                  className="card flex w-full items-start justify-between gap-3 p-4 text-start transition-colors hover:border-accent"
                >
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium text-ink" dir="auto">
                      {h.objective}
                    </span>
                    <span className="mt-0.5 block text-xs text-ink-faint">
                      {depthLabel(h.depth, dict)} · {dict.research.sourcesReviewed}: {h.sourcesCollected} ·{' '}
                      {fmtDate.format(new Date(h.createdAt))}
                    </span>
                  </span>
                  <StatusBadge status={h.status} dict={dict} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
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

function Loading() {
  return (
    <div className="grid place-items-center py-10">
      <span className="h-6 w-6 animate-spin rounded-full border-2 border-line-strong border-t-accent" />
    </div>
  );
}

function BackHeader({ onBack, backLabel }: { onBack: () => void; backLabel: string }) {
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

// ---- Detail: trace + sources + conflicts + report ----

function Detail({
  locale,
  dict,
  id,
  onBack,
}: {
  locale: Locale;
  dict: Dictionary;
  id: string;
  onBack: () => void;
}) {
  const [data, setData] = useState<DetailData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const fmtDateTime = new Intl.DateTimeFormat(locale === 'ar' ? 'ar-AE' : 'en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
  const fmtDate = new Intl.DateTimeFormat(locale === 'ar' ? 'ar-AE' : 'en-US', { dateStyle: 'medium' });
  const fmtCost = new Intl.NumberFormat(locale === 'ar' ? 'ar-AE' : 'en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 4,
  });

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/research/${id}`, { cache: 'no-store' });
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

  // Poll while the session is still working.
  useEffect(() => {
    const status = data?.session.status;
    if (!status || !ACTIVE_STATUSES.includes(status)) return;
    const timer = setInterval(() => {
      void load();
    }, 2000);
    return () => clearInterval(timer);
  }, [data?.session.status, load]);

  async function runPlan() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/research/${id}/run`, { method: 'POST' });
      if (!res.ok) {
        setError(dict.common.somethingWrong);
        return;
      }
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function cancel() {
    setBusy(true);
    try {
      await fetch(`/api/research/${id}/cancel`, { method: 'POST' });
      await load();
    } finally {
      setBusy(false);
    }
  }

  if (!data) {
    return (
      <>
        <BackHeader onBack={onBack} backLabel={dict.research.back} />
        {error ? <p className="mt-6 text-sm text-danger">{error}</p> : <Loading />}
      </>
    );
  }

  const s = data.session;
  const active = ACTIVE_STATUSES.includes(s.status);
  const isPlanningReview = s.status === 'PLANNING';
  const result = data.result;

  // Source id → 1-based index, for citation chips.
  const sourceIndex = new Map<string, number>();
  data.sources.forEach((src, i) => sourceIndex.set(src.id, i + 1));

  return (
    <>
      <BackHeader onBack={onBack} backLabel={dict.research.back} />

      <div className="mt-4 flex flex-wrap items-start justify-between gap-2">
        <h1 className="min-w-0 text-2xl font-bold tracking-tight text-ink" dir="auto">
          {s.objective}
        </h1>
        <StatusBadge status={s.status} dict={dict} />
      </div>

      {error && (
        <p role="alert" className="mt-4 rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger">
          {error}
        </p>
      )}

      {/* Progress line while active */}
      {active && (
        <div className="mt-4 flex items-center gap-2 rounded-lg bg-accent-soft px-3 py-2 text-sm text-accent">
          <span className="h-4 w-4 animate-spin rounded-full border-2 border-accent/30 border-t-accent" />
          {progressLabel(s.status, dict)}
        </div>
      )}

      {/* Stats */}
      <dl className="mt-4 grid gap-2 text-xs sm:grid-cols-4">
        <Stat label={dict.research.depth} value={depthLabel(s.depth, dict)} />
        <Stat label={dict.research.tasksCount} value={`${s.tasksCompleted} / ${s.tasksCreated}`} />
        <Stat label={dict.research.sourcesReviewed} value={String(s.sourcesCollected)} />
        <Stat label={dict.research.agentRuns} value={String(s.agentRunsUsed)} />
        <Stat
          label={`${dict.research.estimatedCost} (${dict.research.estimate})`}
          value={fmtCost.format(s.estimatedCost ?? 0)}
        />
        <Stat label={dict.research.started} value={fmtDateTime.format(new Date(s.createdAt))} />
      </dl>

      {/* Deep-research plan review */}
      {isPlanningReview && (
        <section className="card mt-4 border-accent/40 p-5">
          <h2 className="text-sm font-semibold text-ink">{dict.research.planReviewTitle}</h2>
          <p className="mt-1 text-xs text-ink-soft">{dict.research.planReviewIntro}</p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button onClick={runPlan} disabled={busy} className="btn-primary px-4 py-2 text-sm">
              {busy ? dict.research.running : dict.research.runPlan}
            </button>
            <button onClick={onBack} className="btn-ghost px-3 py-2 text-sm">
              {dict.research.back}
            </button>
          </div>
          <p className="mt-2 text-xs text-ink-faint">{dict.research.adjustHint}</p>
        </section>
      )}

      {/* Cancel while active (and not in the plan-review-only state) */}
      {active && !isPlanningReview && (
        <div className="mt-4">
          <button onClick={cancel} disabled={busy} className="btn-ghost px-3 py-2 text-sm text-danger">
            {busy ? dict.research.canceling : dict.research.cancel}
          </button>
        </div>
      )}

      {/* Plan (areas + questions) */}
      <section className="card mt-4 p-5">
        <h2 className="text-sm font-semibold text-ink">{dict.research.plan}</h2>
        {s.plan.areas.length === 0 && s.plan.questions.length === 0 ? (
          <p className="mt-3 text-sm text-ink-faint">{dict.research.planEmpty}</p>
        ) : (
          <div className="mt-3 grid gap-4 sm:grid-cols-2">
            {s.plan.areas.length > 0 && (
              <div>
                <p className="text-xs font-semibold text-ink-soft">{dict.research.planAreas}</p>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {s.plan.areas.map((a, i) => (
                    <span
                      key={i}
                      dir="auto"
                      className="rounded-full bg-paper-sunken px-2.5 py-0.5 text-xs text-ink-soft"
                    >
                      {a}
                    </span>
                  ))}
                </div>
              </div>
            )}
            {s.plan.questions.length > 0 && (
              <div>
                <p className="text-xs font-semibold text-ink-soft">{dict.research.planQuestions}</p>
                <ul className="mt-2 space-y-1.5">
                  {s.plan.questions.map((q, i) => (
                    <li key={i} className="flex gap-2 text-sm text-ink-soft" dir="auto">
                      <span className="text-ink-faint">{i + 1}.</span>
                      <span>{q}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </section>

      {/* Tasks (research trace) */}
      <section className="card mt-4 p-5">
        <h2 className="text-sm font-semibold text-ink">{dict.research.tasks}</h2>
        {data.tasks.length === 0 ? (
          <p className="mt-3 text-sm text-ink-faint">{dict.research.tasksEmpty}</p>
        ) : (
          <ul className="mt-3 space-y-2">
            {data.tasks.map((t) => (
              <li key={t.id} className="rounded-xl border border-line px-3 py-2.5">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="min-w-0 flex-1 text-sm font-medium text-ink" dir="auto">
                    {t.title}
                  </span>
                  <span
                    className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${taskStatusClass(t.status)}`}
                  >
                    {taskStatusLabel(t.status, dict)}
                  </span>
                </div>
                <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-ink-faint">
                  <span>
                    {dict.research.taskProfile}: <span className="text-ink-soft">{t.profile}</span>
                  </span>
                  {t.scope && (
                    <span dir="auto">
                      {dict.research.taskScope}: <span className="text-ink-soft">{t.scope}</span>
                    </span>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Conflicts */}
      {data.conflicts.length > 0 && (
        <section className="card mt-4 border-gold/40 bg-gold/5 p-5">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-ink">
            <Icon name="spark" width={16} height={16} />
            {dict.research.conflicts}
          </h2>
          <p className="mt-1 text-xs text-ink-soft">{dict.research.conflictsIntro}</p>
          <ul className="mt-3 space-y-1.5">
            {data.conflicts.map((c) => (
              <li key={c.id} className="flex items-center gap-2 text-sm text-ink-soft" dir="auto">
                <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-gold" />
                {c.topic}
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Sources */}
      <section className="card mt-4 p-5">
        <h2 className="text-sm font-semibold text-ink">{dict.research.sourcesPanel}</h2>
        {data.sources.length === 0 ? (
          <p className="mt-3 text-sm text-ink-faint">{dict.research.sourcesEmpty}</p>
        ) : (
          <ul className="mt-3 space-y-2">
            {data.sources.map((src) => {
              const idx = sourceIndex.get(src.id);
              const priv = isPrivateSource(src.sourceType);
              const q = src.quality ?? {};
              return (
                <li
                  key={src.id}
                  id={`src-${src.id}`}
                  className="scroll-mt-4 rounded-xl border border-line px-3 py-2.5"
                >
                  <div className="flex flex-wrap items-start gap-2">
                    {idx != null && (
                      <span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full bg-paper-sunken text-[11px] font-semibold text-ink-soft">
                        {idx}
                      </span>
                    )}
                    <span className="min-w-0 flex-1 text-sm font-medium text-ink" dir="auto">
                      {src.title}
                    </span>
                    <span
                      className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${sourceTypeClass(src.sourceType)}`}
                    >
                      {sourceTypeLabel(src.sourceType, dict)}
                    </span>
                  </div>

                  {/* Quality flags */}
                  {(q.primary || q.official || typeof q.domain === 'string') && (
                    <div className="mt-1.5 flex flex-wrap gap-1.5">
                      {q.primary ? (
                        <span className="rounded-full bg-success/15 px-2 py-0.5 text-[11px] font-medium text-success">
                          {dict.research.qualityPrimary}
                        </span>
                      ) : null}
                      {q.official ? (
                        <span className="rounded-full bg-success/15 px-2 py-0.5 text-[11px] font-medium text-success">
                          {dict.research.qualityOfficial}
                        </span>
                      ) : null}
                      {typeof q.domain === 'string' ? (
                        <span className="rounded-full bg-paper-sunken px-2 py-0.5 text-[11px] font-medium text-ink-soft">
                          {q.domain}
                        </span>
                      ) : null}
                    </div>
                  )}

                  {/* Reference: link for public sources, metadata-only for private */}
                  {priv ? (
                    <p className="mt-1.5 text-[11px] italic text-ink-faint">{dict.research.privateSource}</p>
                  ) : src.reference ? (
                    isHttpUrl(src.reference) ? (
                      <a
                        href={src.reference}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="mt-1.5 block truncate text-xs text-accent hover:underline"
                        dir="ltr"
                      >
                        {src.reference}
                      </a>
                    ) : (
                      <p className="mt-1.5 truncate text-xs text-ink-soft" dir="auto">
                        {src.reference}
                      </p>
                    )
                  ) : null}

                  {(src.retrievedAt || src.publishedAt) && (
                    <p className="mt-1 text-[11px] text-ink-faint">
                      {src.publishedAt && `${dict.research.published}: ${fmtDate.format(new Date(src.publishedAt))}`}
                      {src.publishedAt && src.retrievedAt && ' · '}
                      {src.retrievedAt && `${dict.research.retrieved}: ${fmtDate.format(new Date(src.retrievedAt))}`}
                    </p>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* Report */}
      {result ? (
        <section className="card mt-4 border-accent/40 p-5">
          <h2 className="text-sm font-semibold text-ink">{dict.research.report}</h2>

          {result.partial && (
            <p className="mt-3 rounded-lg bg-gold/15 px-3 py-2 text-sm text-gold">
              {dict.research.partialBanner}
            </p>
          )}

          {result.executiveSummary && (
            <div className="mt-4">
              <p className="text-xs font-semibold text-ink-soft">{dict.research.executiveSummary}</p>
              <p className="mt-1 whitespace-pre-wrap text-sm text-ink" dir="auto">
                {result.executiveSummary}
              </p>
            </div>
          )}

          {result.findings.length > 0 && (
            <div className="mt-4">
              <p className="text-xs font-semibold text-ink-soft">{dict.research.findings}</p>
              <ul className="mt-2 space-y-2">
                {result.findings.map((f, i) => (
                  <FindingRow key={f.id ?? i} finding={f} dict={dict} sourceIndex={sourceIndex} />
                ))}
              </ul>
            </div>
          )}

          {result.analysis && (
            <div className="mt-4">
              <p className="text-xs font-semibold text-ink-soft">{dict.research.analysis}</p>
              <p className="mt-1 whitespace-pre-wrap text-sm text-ink-soft" dir="auto">
                {result.analysis}
              </p>
            </div>
          )}

          {result.uncertainties.length > 0 && (
            <div className="mt-4">
              <p className="text-xs font-semibold text-ink-soft">{dict.research.uncertainties}</p>
              <ul className="mt-2 space-y-1.5">
                {result.uncertainties.map((u, i) => (
                  <li key={i} className="flex gap-2 text-sm text-ink-soft" dir="auto">
                    <span className="text-ink-faint">•</span>
                    <span>{u}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {result.citationIds.length > 0 && (
            <div className="mt-4">
              <p className="text-xs font-semibold text-ink-soft">{dict.research.citations}</p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {result.citationIds.map((cid) => (
                  <CitationChip key={cid} cid={cid} sourceIndex={sourceIndex} dict={dict} />
                ))}
              </div>
            </div>
          )}
        </section>
      ) : (
        // Live findings while there is no final report yet.
        data.findings.length > 0 && (
          <section className="card mt-4 p-5">
            <h2 className="text-sm font-semibold text-ink">{dict.research.findings}</h2>
            <ul className="mt-3 space-y-2">
              {data.findings.map((f, i) => (
                <FindingRow key={f.id ?? i} finding={f} dict={dict} sourceIndex={sourceIndex} />
              ))}
            </ul>
          </section>
        )
      )}
    </>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-line px-3 py-2">
      <dt className="text-ink-faint">{label}</dt>
      <dd className="mt-0.5 truncate font-semibold text-ink">{value}</dd>
    </div>
  );
}

function FindingRow({
  finding,
  dict,
  sourceIndex,
}: {
  finding: Finding;
  dict: Dictionary;
  sourceIndex: Map<string, number>;
}) {
  const conf = confidenceLabel(finding.confidence, dict);
  return (
    <li className="rounded-xl border border-line px-3 py-2.5">
      <div className="flex flex-wrap items-center justify-end gap-1.5">
        <p className="min-w-0 flex-1 text-sm text-ink" dir="auto">
          {finding.claim}
        </p>
        <span
          className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${findingStatusClass(String(finding.status))}`}
        >
          {findingStatusLabel(String(finding.status), dict)}
        </span>
      </div>
      <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
        {conf && (
          <span className="rounded-full bg-paper-sunken px-2 py-0.5 text-[11px] font-medium text-ink-soft">
            {dict.research.confidence}: {conf}
          </span>
        )}
        {finding.citationIds.map((cid) => (
          <CitationChip key={cid} cid={cid} sourceIndex={sourceIndex} dict={dict} />
        ))}
      </div>
    </li>
  );
}

function CitationChip({
  cid,
  sourceIndex,
  dict,
}: {
  cid: string;
  sourceIndex: Map<string, number>;
  dict: Dictionary;
}) {
  const idx = sourceIndex.get(cid);
  if (idx == null) {
    return (
      <span className="rounded-full bg-paper-sunken px-2 py-0.5 text-[11px] font-medium text-ink-faint">
        {dict.research.citation}
      </span>
    );
  }
  return (
    <a
      href={`#src-${cid}`}
      className="rounded-full bg-accent-soft px-2 py-0.5 text-[11px] font-semibold text-accent hover:underline"
      title={dict.research.citation}
    >
      [{idx}]
    </a>
  );
}
