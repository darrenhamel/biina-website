'use client';

import { useCallback, useEffect, useState } from 'react';
import type { Locale } from '@/i18n/config';
import type { Dictionary } from '@/i18n/dictionaries';

type AgentStatus =
  | 'PENDING'
  | 'RUNNING'
  | 'AWAITING_APPROVAL'
  | 'COMPLETED'
  | 'FAILED'
  | 'CANCELED'
  | 'BLOCKED';

interface AdminAgentsData {
  sessions: {
    total: number;
    completed: number;
    failed: number;
    blocked: number;
    awaitingApproval: number;
    active: number;
  };
  actions: {
    total: number;
    succeeded: number;
    blocked: number;
    rejected: number;
    unknownOutcome: number;
    writes: number;
  };
  avgSteps: number;
  estimatedCost: number;
  topTools: Array<{ toolId: string; count: number }>;
  recent: Array<{
    id: string;
    status: AgentStatus;
    mode: string;
    goal: string;
    stepsUsed: number;
    createdAt: string;
  }>;
}

function statusLabel(status: string, dict: Dictionary): string {
  const map: Record<string, string> = {
    PENDING: dict.agent.statusPending,
    RUNNING: dict.agent.statusRunning,
    AWAITING_APPROVAL: dict.agent.statusAwaitingApproval,
    COMPLETED: dict.agent.statusCompleted,
    FAILED: dict.agent.statusFailed,
    CANCELED: dict.agent.statusCanceled,
    BLOCKED: dict.agent.statusBlocked,
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
      return 'bg-gold/15 text-gold';
    case 'RUNNING':
    case 'PENDING':
      return 'bg-accent-soft text-accent';
    default:
      return 'bg-paper-sunken text-ink-soft';
  }
}

export function AdminAgentsPanel({ locale, dict }: { locale: Locale; dict: Dictionary }) {
  const [data, setData] = useState<AdminAgentsData | null>(null);
  const [error, setError] = useState<string | null>(null);

  const num = new Intl.NumberFormat(locale === 'ar' ? 'ar-AE' : 'en-US');
  const fmtCost = new Intl.NumberFormat(locale === 'ar' ? 'ar-AE' : 'en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 4,
  });
  const fmtDateTime = new Intl.DateTimeFormat(locale === 'ar' ? 'ar-AE' : 'en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
  });

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch('/api/admin/agents', { cache: 'no-store' });
      if (!res.ok) throw new Error();
      setData(await res.json());
    } catch {
      setError(dict.common.somethingWrong);
    }
  }, [dict]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!data) {
    return (
      <div className="grid h-full place-items-center">
        {error ? (
          <p className="text-sm text-danger">{error}</p>
        ) : (
          <span className="h-6 w-6 animate-spin rounded-full border-2 border-line-strong border-t-accent" />
        )}
      </div>
    );
  }

  const sessionTiles: Array<{ label: string; value: string }> = [
    { label: dict.adminAgents.total, value: num.format(data.sessions.total) },
    { label: dict.adminAgents.completed, value: num.format(data.sessions.completed) },
    { label: dict.adminAgents.active, value: num.format(data.sessions.active) },
    { label: dict.adminAgents.awaitingApproval, value: num.format(data.sessions.awaitingApproval) },
    { label: dict.adminAgents.failed, value: num.format(data.sessions.failed) },
    { label: dict.adminAgents.blocked, value: num.format(data.sessions.blocked) },
  ];

  const actionTiles: Array<{ label: string; value: string }> = [
    { label: dict.adminAgents.total, value: num.format(data.actions.total) },
    { label: dict.adminAgents.succeeded, value: num.format(data.actions.succeeded) },
    { label: dict.adminAgents.blocked, value: num.format(data.actions.blocked) },
    { label: dict.adminAgents.rejected, value: num.format(data.actions.rejected) },
    { label: dict.adminAgents.unknownOutcome, value: num.format(data.actions.unknownOutcome) },
    { label: dict.adminAgents.writes, value: num.format(data.actions.writes) },
  ];

  return (
    <div className="scroll-slim h-full overflow-y-auto">
      <div className="mx-auto max-w-4xl px-5 py-8">
        <h1 className="text-2xl font-bold tracking-tight text-ink">{dict.adminAgents.title}</h1>
        <p className="mt-1 text-sm text-ink-soft">{dict.adminAgents.subtitle}</p>

        {error && (
          <p className="mt-4 rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger">{error}</p>
        )}

        {/* Headline metrics */}
        <div className="mt-6 grid gap-3 sm:grid-cols-3">
          <div className="card p-5">
            <p className="text-3xl font-bold text-ink">{num.format(data.avgSteps)}</p>
            <p className="mt-1 text-sm text-ink-soft">{dict.adminAgents.avgSteps}</p>
          </div>
          <div className="card p-5">
            <p className="text-3xl font-bold text-ink">{fmtCost.format(data.estimatedCost)}</p>
            <p className="mt-1 text-sm text-ink-soft">
              {dict.adminAgents.estimatedCost} ({dict.adminAgents.estimate})
            </p>
          </div>
          <div className="card p-5">
            <p className="text-3xl font-bold text-ink">{num.format(data.sessions.total)}</p>
            <p className="mt-1 text-sm text-ink-soft">{dict.adminAgents.sessions}</p>
          </div>
        </div>

        {/* Sessions breakdown */}
        <h2 className="mt-6 text-sm font-semibold text-ink-soft">{dict.adminAgents.sessions}</h2>
        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          {sessionTiles.map((t) => (
            <div key={t.label} className="rounded-xl border border-line p-4">
              <p className="text-xl font-bold text-ink">{t.value}</p>
              <p className="mt-0.5 text-xs text-ink-soft">{t.label}</p>
            </div>
          ))}
        </div>

        {/* Actions breakdown */}
        <h2 className="mt-6 text-sm font-semibold text-ink-soft">{dict.adminAgents.actions}</h2>
        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          {actionTiles.map((t) => (
            <div key={t.label} className="rounded-xl border border-line p-4">
              <p className="text-xl font-bold text-ink">{t.value}</p>
              <p className="mt-0.5 text-xs text-ink-soft">{t.label}</p>
            </div>
          ))}
        </div>

        {/* Top tools */}
        <section className="card mt-6 p-5">
          <h2 className="mb-3 text-sm font-semibold text-ink">{dict.adminAgents.topTools}</h2>
          {data.topTools.length === 0 ? (
            <p className="text-sm text-ink-faint">{dict.adminAgents.noData}</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-start text-sm">
                <thead>
                  <tr className="text-xs uppercase tracking-wide text-ink-faint">
                    <th className="px-2 py-1 text-start font-medium">{dict.adminAgents.tool}</th>
                    <th className="px-2 py-1 text-start font-medium">{dict.adminAgents.count}</th>
                  </tr>
                </thead>
                <tbody className="text-ink-soft">
                  {data.topTools.map((t) => (
                    <tr key={t.toolId} className="border-t border-line">
                      <td className="px-2 py-2 font-medium text-ink">{t.toolId}</td>
                      <td className="px-2 py-2">{num.format(t.count)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {/* Recent sessions */}
        <section className="card mt-4 p-5">
          <h2 className="mb-3 text-sm font-semibold text-ink">{dict.adminAgents.recent}</h2>
          {data.recent.length === 0 ? (
            <p className="text-sm text-ink-faint">{dict.adminAgents.noData}</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-start text-sm">
                <thead>
                  <tr className="text-xs uppercase tracking-wide text-ink-faint">
                    <th className="px-2 py-1 text-start font-medium">{dict.adminAgents.goal}</th>
                    <th className="px-2 py-1 text-start font-medium">{dict.adminAgents.mode}</th>
                    <th className="px-2 py-1 text-start font-medium">{dict.adminAgents.steps}</th>
                    <th className="px-2 py-1 text-start font-medium">{dict.adminAgents.status}</th>
                    <th className="px-2 py-1 text-start font-medium">{dict.adminAgents.started}</th>
                  </tr>
                </thead>
                <tbody className="text-ink-soft">
                  {data.recent.map((r) => (
                    <tr key={r.id} className="border-t border-line align-top">
                      <td className="max-w-xs px-2 py-2">
                        <span className="block truncate font-medium text-ink">{r.goal}</span>
                      </td>
                      <td className="px-2 py-2">{r.mode}</td>
                      <td className="px-2 py-2">{num.format(r.stepsUsed)}</td>
                      <td className="px-2 py-2">
                        <span
                          className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${statusClass(r.status)}`}
                        >
                          {statusLabel(r.status, dict)}
                        </span>
                      </td>
                      <td className="px-2 py-2 text-xs text-ink-faint">
                        {fmtDateTime.format(new Date(r.createdAt))}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
