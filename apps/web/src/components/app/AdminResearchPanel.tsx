'use client';

import { useCallback, useEffect, useState } from 'react';
import type { Locale } from '@/i18n/config';
import type { Dictionary } from '@/i18n/dictionaries';

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

interface AdminResearchData {
  killSwitches: {
    advancedResearch: boolean;
    multiAgent: boolean;
    web: boolean;
  };
  sessions: {
    total: number;
    completed: number;
    partial: number;
    failed: number;
    blocked: number;
    running: number;
  };
  today: number;
  avgSources: number;
  avgCost: number;
  avgTasks: number;
  recent: Array<{
    id: string;
    status: ResearchStatus;
    depth: Depth;
    objective: string;
    sources: number;
    createdAt: string;
  }>;
}

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
    QUICK: dict.adminResearch.depthQuick,
    STANDARD: dict.adminResearch.depthStandard,
    DEEP: dict.adminResearch.depthDeep,
  };
  return map[depth] ?? depth;
}

function SwitchBadge({ on, dict }: { on: boolean; dict: Dictionary }) {
  return (
    <span
      className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${
        on ? 'bg-success/15 text-success' : 'bg-paper-sunken text-ink-soft'
      }`}
    >
      {on ? dict.adminResearch.enabled : dict.adminResearch.disabled}
    </span>
  );
}

export function AdminResearchPanel({ locale, dict }: { locale: Locale; dict: Dictionary }) {
  const [data, setData] = useState<AdminResearchData | null>(null);
  const [error, setError] = useState<string | null>(null);

  const num = new Intl.NumberFormat(locale === 'ar' ? 'ar-AE' : 'en-US', { maximumFractionDigits: 1 });
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
      const res = await fetch('/api/admin/research', { cache: 'no-store' });
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
    { label: dict.adminResearch.total, value: num.format(data.sessions.total) },
    { label: dict.adminResearch.completed, value: num.format(data.sessions.completed) },
    { label: dict.adminResearch.partial, value: num.format(data.sessions.partial) },
    { label: dict.adminResearch.running, value: num.format(data.sessions.running) },
    { label: dict.adminResearch.failed, value: num.format(data.sessions.failed) },
    { label: dict.adminResearch.blocked, value: num.format(data.sessions.blocked) },
  ];

  return (
    <div className="scroll-slim h-full overflow-y-auto">
      <div className="mx-auto max-w-4xl px-5 py-8">
        <h1 className="text-2xl font-bold tracking-tight text-ink">{dict.adminResearch.title}</h1>
        <p className="mt-1 text-sm text-ink-soft">{dict.adminResearch.subtitle}</p>

        {error && (
          <p className="mt-4 rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger">{error}</p>
        )}

        {/* Kill switches */}
        <h2 className="mt-6 text-sm font-semibold text-ink-soft">{dict.adminResearch.controls}</h2>
        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          <div className="card flex items-center justify-between p-4">
            <span className="text-sm font-medium text-ink">{dict.adminResearch.advancedResearch}</span>
            <SwitchBadge on={data.killSwitches.advancedResearch} dict={dict} />
          </div>
          <div className="card flex items-center justify-between p-4">
            <span className="text-sm font-medium text-ink">{dict.adminResearch.multiAgent}</span>
            <SwitchBadge on={data.killSwitches.multiAgent} dict={dict} />
          </div>
          <div className="card flex items-center justify-between p-4">
            <span className="text-sm font-medium text-ink">{dict.adminResearch.web}</span>
            <SwitchBadge on={data.killSwitches.web} dict={dict} />
          </div>
        </div>

        {/* Headline metrics */}
        <div className="mt-6 grid gap-3 sm:grid-cols-4">
          <div className="card p-5">
            <p className="text-3xl font-bold text-ink">{num.format(data.today)}</p>
            <p className="mt-1 text-sm text-ink-soft">{dict.adminResearch.today}</p>
          </div>
          <div className="card p-5">
            <p className="text-3xl font-bold text-ink">{num.format(data.avgSources)}</p>
            <p className="mt-1 text-sm text-ink-soft">{dict.adminResearch.avgSources}</p>
          </div>
          <div className="card p-5">
            <p className="text-3xl font-bold text-ink">{num.format(data.avgTasks)}</p>
            <p className="mt-1 text-sm text-ink-soft">{dict.adminResearch.avgTasks}</p>
          </div>
          <div className="card p-5">
            <p className="text-3xl font-bold text-ink">{fmtCost.format(data.avgCost)}</p>
            <p className="mt-1 text-sm text-ink-soft">
              {dict.adminResearch.avgCost} ({dict.adminResearch.estimate})
            </p>
          </div>
        </div>

        {/* Sessions breakdown */}
        <h2 className="mt-6 text-sm font-semibold text-ink-soft">{dict.adminResearch.sessions}</h2>
        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          {sessionTiles.map((t) => (
            <div key={t.label} className="rounded-xl border border-line p-4">
              <p className="text-xl font-bold text-ink">{t.value}</p>
              <p className="mt-0.5 text-xs text-ink-soft">{t.label}</p>
            </div>
          ))}
        </div>

        {/* Recent runs */}
        <section className="card mt-6 p-5">
          <h2 className="mb-3 text-sm font-semibold text-ink">{dict.adminResearch.recent}</h2>
          {data.recent.length === 0 ? (
            <p className="text-sm text-ink-faint">{dict.adminResearch.noData}</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-start text-sm">
                <thead>
                  <tr className="text-xs uppercase tracking-wide text-ink-faint">
                    <th className="px-2 py-1 text-start font-medium">{dict.adminResearch.objective}</th>
                    <th className="px-2 py-1 text-start font-medium">{dict.adminResearch.depth}</th>
                    <th className="px-2 py-1 text-start font-medium">{dict.adminResearch.sources}</th>
                    <th className="px-2 py-1 text-start font-medium">{dict.adminResearch.status}</th>
                    <th className="px-2 py-1 text-start font-medium">{dict.adminResearch.started}</th>
                  </tr>
                </thead>
                <tbody className="text-ink-soft">
                  {data.recent.map((r) => (
                    <tr key={r.id} className="border-t border-line align-top">
                      <td className="max-w-xs px-2 py-2">
                        <span className="block truncate font-medium text-ink" dir="auto">
                          {r.objective}
                        </span>
                      </td>
                      <td className="px-2 py-2">{depthLabel(r.depth, dict)}</td>
                      <td className="px-2 py-2">{num.format(r.sources)}</td>
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
