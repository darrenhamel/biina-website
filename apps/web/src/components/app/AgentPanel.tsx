'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { Locale } from '@/i18n/config';
import type { Dictionary } from '@/i18n/dictionaries';
import { Icon } from '@/components/Icon';

type AgentStatus =
  | 'PENDING'
  | 'RUNNING'
  | 'AWAITING_APPROVAL'
  | 'COMPLETED'
  | 'FAILED'
  | 'CANCELED'
  | 'BLOCKED';

type Mode = 'ASSISTED' | 'AGENT';

interface PreviewField {
  label: string;
  value: string;
}

interface ActionPreview {
  actionType: string;
  toolId: string;
  connectorSlug: string;
  riskLevel: string;
  reversibility: string;
  requiresApproval: boolean;
  title: string;
  description: string;
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

interface SessionStep {
  index: number;
  type: string;
  toolId: string | null;
  status: string;
  input: unknown;
  output: unknown;
}

interface SessionAction {
  id: string;
  toolId: string;
  risk: string;
  status: string;
  externalResourceId: string | null;
  resultSummary: string | null;
}

interface SessionDetail {
  session: {
    id: string;
    status: AgentStatus;
    mode: Mode;
    goal: string;
    plan: string[];
    stepsUsed: number;
    writeActionsUsed: number;
    estimatedCost: number;
    dryRun: boolean;
    createdAt: string;
    completedAt: string | null;
  };
  steps: SessionStep[];
  actions: SessionAction[];
  pendingApproval: PendingApproval | null;
}

interface HistoryItem {
  id: string;
  status: AgentStatus;
  mode: Mode;
  goal: string;
  stepsUsed: number;
  writeActionsUsed: number;
  createdAt: string;
  completedAt: string | null;
}

const ACTIVE_STATUSES: AgentStatus[] = ['PENDING', 'RUNNING'];

function statusLabel(status: AgentStatus, dict: Dictionary): string {
  const map: Record<AgentStatus, string> = {
    PENDING: dict.agent.statusPending,
    RUNNING: dict.agent.statusRunning,
    AWAITING_APPROVAL: dict.agent.statusAwaitingApproval,
    COMPLETED: dict.agent.statusCompleted,
    FAILED: dict.agent.statusFailed,
    CANCELED: dict.agent.statusCanceled,
    BLOCKED: dict.agent.statusBlocked,
  };
  return map[status];
}

function statusClass(status: AgentStatus): string {
  switch (status) {
    case 'COMPLETED':
      return 'bg-success/15 text-success';
    case 'FAILED':
    case 'BLOCKED':
      return 'bg-danger/10 text-danger';
    case 'AWAITING_APPROVAL':
      return 'bg-gold/15 text-gold';
    case 'RUNNING':
    case 'PENDING':
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

function StatusBadge({ status, dict }: { status: AgentStatus; dict: Dictionary }) {
  return (
    <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${statusClass(status)}`}>
      {statusLabel(status, dict)}
    </span>
  );
}

function RiskBadge({ risk, dict }: { risk: string; dict: Dictionary }) {
  return (
    <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${riskClass(risk)}`}>
      {riskLabel(risk, dict)}
    </span>
  );
}

/** camelCase a human label to use as an editedArguments key. */
function toKey(label: string): string {
  const parts = label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean);
  if (parts.length === 0) return 'field';
  return parts[0] + parts.slice(1).map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join('');
}

function summarize(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  try {
    const s = JSON.stringify(value);
    return s.length > 240 ? s.slice(0, 240) + '…' : s;
  } catch {
    return null;
  }
}

export function AgentPanel({ locale, dict }: { locale: Locale; dict: Dictionary }) {
  const [goal, setGoal] = useState('');
  const [mode, setMode] = useState<Mode>('ASSISTED');
  const [dryRun, setDryRun] = useState(false);
  const [starting, setStarting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [detail, setDetail] = useState<SessionDetail | null>(null);
  const [history, setHistory] = useState<HistoryItem[]>([]);

  const sessionIdRef = useRef<string | null>(null);

  const fmtDateTime = new Intl.DateTimeFormat(locale === 'ar' ? 'ar-AE' : 'en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
  const fmtCost = new Intl.NumberFormat(locale === 'ar' ? 'ar-AE' : 'en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 4,
  });

  const loadHistory = useCallback(async () => {
    try {
      const res = await fetch('/api/agent/sessions', { cache: 'no-store' });
      if (!res.ok) return;
      const body = await res.json();
      setHistory(Array.isArray(body.sessions) ? body.sessions : []);
    } catch {
      /* non-fatal */
    }
  }, []);

  const loadDetail = useCallback(async (id: string) => {
    try {
      const res = await fetch(`/api/agent/sessions/${id}`, { cache: 'no-store' });
      if (!res.ok) return;
      setDetail(await res.json());
    } catch {
      /* non-fatal */
    }
  }, []);

  useEffect(() => {
    void loadHistory();
  }, [loadHistory]);

  // Poll while the active session is still working.
  useEffect(() => {
    const status = detail?.session.status;
    const id = detail?.session.id;
    if (!id || !status || !ACTIVE_STATUSES.includes(status)) return;
    const timer = setInterval(() => {
      void loadDetail(id);
    }, 1800);
    return () => clearInterval(timer);
  }, [detail?.session.status, detail?.session.id, loadDetail]);

  // Refresh history whenever a run reaches a terminal-ish state.
  useEffect(() => {
    const status = detail?.session.status;
    if (status && !ACTIVE_STATUSES.includes(status)) void loadHistory();
  }, [detail?.session.status, loadHistory]);

  async function start() {
    const trimmed = goal.trim();
    if (trimmed.length < 3) return;
    setStarting(true);
    setError(null);
    setDetail(null);
    try {
      const res = await fetch('/api/agent/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ goal: trimmed, mode, dryRun }),
      });
      if (res.status === 403) {
        setError(dict.agent.unavailable);
        return;
      }
      if (!res.ok) {
        setError(dict.common.somethingWrong);
        return;
      }
      const body = await res.json();
      if (body?.sessionId) {
        sessionIdRef.current = body.sessionId;
        await loadDetail(body.sessionId);
      }
    } catch {
      setError(dict.common.somethingWrong);
    } finally {
      setStarting(false);
    }
  }

  async function cancel() {
    const id = detail?.session.id;
    if (!id) return;
    setBusy(true);
    try {
      await fetch(`/api/agent/sessions/${id}/cancel`, { method: 'POST' });
      await loadDetail(id);
    } finally {
      setBusy(false);
    }
  }

  async function decide(
    approvalId: string,
    decision: 'APPROVED' | 'REJECTED',
    editedArguments?: Record<string, unknown>,
  ) {
    const id = detail?.session.id;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/agent/approvals/${approvalId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          editedArguments && Object.keys(editedArguments).length > 0
            ? { decision, editedArguments }
            : { decision },
        ),
      });
      if (!res.ok) {
        setError(dict.common.somethingWrong);
        return;
      }
      if (id) await loadDetail(id);
    } catch {
      setError(dict.common.somethingWrong);
    } finally {
      setBusy(false);
    }
  }

  const session = detail?.session ?? null;
  const canStart = goal.trim().length >= 3 && !starting;

  return (
    <div className="scroll-slim h-full overflow-y-auto">
      <div className="mx-auto max-w-3xl px-5 py-8">
        <h1 className="text-2xl font-bold tracking-tight text-ink">{dict.agent.title}</h1>
        <p className="mt-1 text-sm text-ink-soft">{dict.agent.subtitle}</p>

        {error && (
          <p role="alert" className="mt-4 rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger">
            {error}
          </p>
        )}

        {/* Task composer */}
        <section className="card mt-6 p-5">
          <label htmlFor="agent-goal" className="text-sm font-semibold text-ink">
            {dict.agent.goalLabel}
          </label>
          <textarea
            id="agent-goal"
            value={goal}
            onChange={(e) => setGoal(e.target.value)}
            placeholder={dict.agent.goalPlaceholder}
            rows={3}
            maxLength={4000}
            className="mt-2 w-full resize-y rounded-xl border border-line bg-paper px-3 py-2 text-sm text-ink outline-none focus:border-accent"
          />

          <div className="mt-4">
            <p className="text-xs font-semibold text-ink-soft">{dict.agent.mode}</p>
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              <ModeCard
                active={mode === 'ASSISTED'}
                title={dict.agent.modeAssisted}
                hint={dict.agent.modeAssistedHint}
                onClick={() => setMode('ASSISTED')}
              />
              <ModeCard
                active={mode === 'AGENT'}
                title={dict.agent.modeAgent}
                hint={dict.agent.modeAgentHint}
                onClick={() => setMode('AGENT')}
              />
            </div>
          </div>

          <label className="mt-4 flex items-start gap-2.5">
            <input
              type="checkbox"
              checked={dryRun}
              onChange={(e) => setDryRun(e.target.checked)}
              className="mt-0.5 h-4 w-4 accent-accent"
            />
            <span>
              <span className="block text-sm font-medium text-ink">{dict.agent.dryRun}</span>
              <span className="block text-xs text-ink-faint">{dict.agent.dryRunHint}</span>
            </span>
          </label>

          <div className="mt-4 flex items-center gap-2">
            <button onClick={start} className="btn-primary px-4 py-2 text-sm" disabled={!canStart}>
              {starting ? dict.agent.starting : dict.agent.start}
            </button>
            {session && ACTIVE_STATUSES.includes(session.status) && (
              <button
                onClick={cancel}
                className="btn-ghost px-3 py-2 text-sm text-danger"
                disabled={busy}
              >
                {dict.agent.cancel}
              </button>
            )}
          </div>
        </section>

        {session && (
          <>
            {/* Run header */}
            <section className="card mt-4 p-5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-sm font-semibold text-ink">{dict.agent.result}</h2>
                <div className="flex items-center gap-2">
                  {session.dryRun && (
                    <span className="rounded-full bg-paper-sunken px-2.5 py-0.5 text-xs font-medium text-ink-soft">
                      {dict.agent.dryRun}
                    </span>
                  )}
                  <StatusBadge status={session.status} dict={dict} />
                </div>
              </div>

              {detail?.session.status === 'COMPLETED' && detail && (
                <ResultMessage detail={detail} />
              )}

              <dl className="mt-3 grid gap-2 text-xs sm:grid-cols-4">
                <Stat label={dict.agent.steps} value={String(session.stepsUsed)} />
                <Stat label={dict.agent.writes} value={String(session.writeActionsUsed)} />
                <Stat
                  label={`${dict.agent.estimatedCost} (${dict.agent.estimate})`}
                  value={fmtCost.format(session.estimatedCost ?? 0)}
                />
                <Stat label={dict.agent.started} value={fmtDateTime.format(new Date(session.createdAt))} />
              </dl>
            </section>

            {/* Plan */}
            <section className="card mt-4 p-5">
              <h2 className="text-sm font-semibold text-ink">{dict.agent.plan}</h2>
              <p className="mt-0.5 text-xs text-ink-faint">{dict.agent.planNote}</p>
              {session.plan.length === 0 ? (
                <p className="mt-3 text-sm text-ink-faint">{dict.agent.planEmpty}</p>
              ) : (
                <ol className="mt-3 space-y-2">
                  {session.plan.map((stepText, i) => (
                    <li key={i} className="flex gap-3 text-sm text-ink-soft">
                      <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-accent-soft text-xs font-semibold text-accent">
                        {i + 1}
                      </span>
                      <span className="pt-0.5">{stepText}</span>
                    </li>
                  ))}
                </ol>
              )}
            </section>

            {/* Approval card */}
            {session.status === 'AWAITING_APPROVAL' && detail?.pendingApproval && (
              <ApprovalCard
                dict={dict}
                fmtDateTime={fmtDateTime}
                approval={detail.pendingApproval}
                busy={busy}
                onApprove={(edited) => decide(detail.pendingApproval!.id, 'APPROVED', edited)}
                onReject={() => decide(detail.pendingApproval!.id, 'REJECTED')}
              />
            )}

            {/* Progress */}
            <section className="card mt-4 p-5">
              <h2 className="text-sm font-semibold text-ink">{dict.agent.progress}</h2>
              {(!detail || detail.steps.length === 0) ? (
                <p className="mt-3 text-sm text-ink-faint">{dict.agent.progressEmpty}</p>
              ) : (
                <ul className="mt-3 space-y-2">
                  {detail.steps.map((step) => {
                    const out = summarize(step.output);
                    const external = /send|create|update|delete|write|email|message|post/i.test(
                      `${step.type} ${step.toolId ?? ''}`,
                    );
                    return (
                      <li key={step.index} className="rounded-xl border border-line px-3 py-2">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-xs font-semibold text-ink">
                            {dict.agent.step} {step.index + 1}
                          </span>
                          <span className="text-xs text-ink-soft">{step.type}</span>
                          {step.toolId && (
                            <code className="rounded bg-paper-sunken px-1.5 py-0.5 text-[11px] text-ink-soft">
                              {step.toolId}
                            </code>
                          )}
                          <span className="ms-auto text-[11px] uppercase tracking-wide text-ink-faint">
                            {step.status}
                          </span>
                        </div>
                        {external && (
                          <p className="mt-1.5 inline-flex items-center gap-1 rounded-full bg-gold/15 px-2 py-0.5 text-[11px] font-medium text-gold">
                            <Icon name="spark" width={12} height={12} />
                            {dict.agent.externalActionNotice}
                          </p>
                        )}
                        {out && <p className="mt-1.5 whitespace-pre-wrap text-xs text-ink-soft">{out}</p>}
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>
          </>
        )}

        {/* History */}
        <section className="mt-8">
          <h2 className="text-sm font-semibold text-ink-soft">{dict.agent.history}</h2>
          {history.length === 0 ? (
            <p className="mt-3 text-sm text-ink-faint">{dict.agent.historyEmpty}</p>
          ) : (
            <ul className="mt-3 space-y-2">
              {history.map((h) => (
                <li key={h.id}>
                  <button
                    onClick={() => {
                      sessionIdRef.current = h.id;
                      void loadDetail(h.id);
                    }}
                    className="card flex w-full items-start justify-between gap-3 p-4 text-start transition-colors hover:border-accent"
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium text-ink">{h.goal}</span>
                      <span className="mt-0.5 block text-xs text-ink-faint">
                        {fmtDateTime.format(new Date(h.createdAt))}
                      </span>
                    </span>
                    <StatusBadge status={h.status} dict={dict} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}

function ModeCard({
  active,
  title,
  hint,
  onClick,
}: {
  active: boolean;
  title: string;
  hint: string;
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
      <span className="mt-0.5 block text-xs text-ink-soft">{hint}</span>
    </button>
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

/** The final assistant message lives on the last completed step's output. */
function ResultMessage({ detail }: { detail: SessionDetail }) {
  const last = [...detail.steps].reverse().find((s) => summarize(s.output));
  const text = last ? summarize(last.output) : null;
  if (!text) return null;
  return <p className="mt-3 whitespace-pre-wrap text-sm text-ink">{text}</p>;
}

function ApprovalCard({
  dict,
  fmtDateTime,
  approval,
  busy,
  onApprove,
  onReject,
}: {
  dict: Dictionary;
  fmtDateTime: Intl.DateTimeFormat;
  approval: PendingApproval;
  busy: boolean;
  onApprove: (edited?: Record<string, unknown>) => void;
  onReject: () => void;
}) {
  const p = approval.preview;
  const [editing, setEditing] = useState(false);
  const [recipient, setRecipient] = useState(p.recipient ?? '');
  const [destination, setDestination] = useState(p.destination ?? '');
  const [content, setContent] = useState(p.contentPreview ?? '');
  const [fields, setFields] = useState<PreviewField[]>(p.fields ?? []);

  function buildEdited(): Record<string, unknown> {
    const edited: Record<string, unknown> = {};
    if (p.recipient != null && recipient !== p.recipient) edited.recipient = recipient;
    if (p.destination != null && destination !== p.destination) edited.destination = destination;
    if (p.contentPreview != null && content !== p.contentPreview) edited.content = content;
    (p.fields ?? []).forEach((orig, i) => {
      const cur = fields[i];
      if (cur && cur.value !== orig.value) edited[toKey(orig.label)] = cur.value;
    });
    return edited;
  }

  return (
    <section className="card mt-4 border-gold/40 p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-ink">
          <Icon name="shield" width={16} height={16} />
          {dict.agent.approvalTitle}
        </h2>
        <RiskBadge risk={p.riskLevel} dict={dict} />
      </div>

      <p className="mt-2 rounded-lg bg-gold/15 px-3 py-2 text-xs text-ink-soft">
        {dict.agent.approvalIntro}
      </p>

      <h3 className="mt-3 text-sm font-semibold text-ink">{p.title}</h3>
      {p.description && <p className="mt-1 text-sm text-ink-soft">{p.description}</p>}

      <dl className="mt-3 grid gap-2 text-xs sm:grid-cols-2">
        {p.recipient != null && (
          <Field label={dict.agent.recipient}>
            {editing ? (
              <input
                value={recipient}
                onChange={(e) => setRecipient(e.target.value)}
                className="w-full rounded-lg border border-line bg-paper px-2 py-1 text-sm text-ink outline-none focus:border-accent"
              />
            ) : (
              <span className="font-medium text-ink">{recipient || '—'}</span>
            )}
          </Field>
        )}
        {p.destination != null && (
          <Field label={dict.agent.destination}>
            {editing ? (
              <input
                value={destination}
                onChange={(e) => setDestination(e.target.value)}
                className="w-full rounded-lg border border-line bg-paper px-2 py-1 text-sm text-ink outline-none focus:border-accent"
              />
            ) : (
              <span className="font-medium text-ink">{destination || '—'}</span>
            )}
          </Field>
        )}
        <Field label={dict.agent.reversibility}>
          <span className="text-ink-soft">{p.reversibility}</span>
        </Field>
        {p.affectedResources.length > 0 && (
          <Field label={dict.agent.affectedResources}>
            <span className="text-ink-soft">{p.affectedResources.join(', ')}</span>
          </Field>
        )}
      </dl>

      {(p.fields?.length ?? 0) > 0 && (
        <dl className="mt-3 space-y-2 text-xs">
          {fields.map((f, i) => (
            <Field key={i} label={f.label}>
              {editing ? (
                <input
                  value={f.value}
                  onChange={(e) =>
                    setFields((prev) => prev.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)))
                  }
                  className="w-full rounded-lg border border-line bg-paper px-2 py-1 text-sm text-ink outline-none focus:border-accent"
                />
              ) : (
                <span className="text-ink-soft">{f.value}</span>
              )}
            </Field>
          ))}
        </dl>
      )}

      {p.contentPreview != null && (
        <div className="mt-3">
          <p className="text-xs font-semibold text-ink-soft">{dict.agent.content}</p>
          {editing ? (
            <textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              rows={4}
              className="mt-1 w-full resize-y rounded-xl border border-line bg-paper px-3 py-2 text-sm text-ink outline-none focus:border-accent"
            />
          ) : (
            <p className="mt-1 whitespace-pre-wrap rounded-xl border border-line bg-paper-sunken px-3 py-2 text-sm text-ink-soft">
              {content}
            </p>
          )}
        </div>
      )}

      <p className="mt-3 text-xs text-ink-faint">
        {dict.agent.expires}: {fmtDateTime.format(new Date(approval.expiresAt))}
      </p>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        {editing ? (
          <>
            <button
              onClick={() => onApprove(buildEdited())}
              className="btn-primary px-3 py-1.5 text-xs"
              disabled={busy}
            >
              {busy ? dict.agent.working : dict.agent.editApprove}
            </button>
            <button
              onClick={() => setEditing(false)}
              className="btn-ghost px-3 py-1.5 text-xs"
              disabled={busy}
            >
              {dict.common.cancel}
            </button>
          </>
        ) : (
          <>
            <button
              onClick={() => onApprove()}
              className="btn-primary px-3 py-1.5 text-xs"
              disabled={busy}
            >
              {busy ? dict.agent.working : dict.agent.approve}
            </button>
            <button
              onClick={() => setEditing(true)}
              className="btn-ghost px-3 py-1.5 text-xs"
              disabled={busy}
            >
              {dict.agent.edit}
            </button>
            <button
              onClick={onReject}
              className="btn-ghost px-3 py-1.5 text-xs text-danger"
              disabled={busy}
            >
              {dict.agent.reject}
            </button>
          </>
        )}
      </div>
      {editing && <p className="mt-2 text-xs text-ink-faint">{dict.agent.editHint}</p>}
    </section>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-ink-faint">{label}</dt>
      <dd className="mt-0.5">{children}</dd>
    </div>
  );
}
