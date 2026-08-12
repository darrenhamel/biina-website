'use client';

import { useCallback, useEffect, useState } from 'react';
import type { Locale } from '@/i18n/config';
import type { Dictionary } from '@/i18n/dictionaries';

interface AdminAutomationsData {
  killSwitches: { workflowsEnabled: boolean; schedulerEnabled: boolean; scheduledWritesEnabled: boolean };
  workflows: { total: number; active: number; paused: number; autoPaused: number; draft: number };
  runsToday: number;
  runs: { completed: number; failed: number; blocked: number; awaitingApproval: number; skipped: number };
  scheduledWrites: number;
  avgCost: number;
  queueDepth: number;
  recent: Array<{ id: string; workflowId: string; status: string; trigger: string; createdAt: string; writeActions: number }>;
  schedulerHealth: { overdue: number };
}

function runStatusLabel(status: string, dict: Dictionary): string {
  const map: Record<string, string> = {
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

function runStatusClass(status: string): string {
  switch (status) {
    case 'COMPLETED':
      return 'bg-success/15 text-success';
    case 'FAILED':
    case 'BLOCKED':
      return 'bg-danger/10 text-danger';
    case 'AWAITING_APPROVAL':
      return 'bg-gold/15 text-gold';
    case 'RUNNING':
    case 'QUEUED':
      return 'bg-accent-soft text-accent';
    case 'PARTIALLY_COMPLETED':
      return 'bg-gold/15 text-gold';
    default:
      return 'bg-paper-sunken text-ink-soft';
  }
}

export function AdminAutomationsPanel({ locale, dict }: { locale: Locale; dict: Dictionary }) {
  const [data, setData] = useState<AdminAutomationsData | null>(null);
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
      const res = await fetch('/api/admin/automations', { cache: 'no-store' });
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

  const switches: Array<{ label: string; on: boolean }> = [
    { label: dict.adminAutomations.workflowsEnabled, on: data.killSwitches.workflowsEnabled },
    { label: dict.adminAutomations.schedulerEnabled, on: data.killSwitches.schedulerEnabled },
    { label: dict.adminAutomations.scheduledWritesEnabled, on: data.killSwitches.scheduledWritesEnabled },
  ];

  const wfTiles: Array<{ label: string; value: string }> = [
    { label: dict.adminAutomations.total, value: num.format(data.workflows.total) },
    { label: dict.adminAutomations.active, value: num.format(data.workflows.active) },
    { label: dict.adminAutomations.paused, value: num.format(data.workflows.paused) },
    { label: dict.adminAutomations.autoPaused, value: num.format(data.workflows.autoPaused) },
    { label: dict.adminAutomations.draft, value: num.format(data.workflows.draft) },
  ];

  const runTiles: Array<{ label: string; value: string }> = [
    { label: dict.adminAutomations.completed, value: num.format(data.runs.completed) },
    { label: dict.adminAutomations.failed, value: num.format(data.runs.failed) },
    { label: dict.adminAutomations.blocked, value: num.format(data.runs.blocked) },
    { label: dict.adminAutomations.awaitingApproval, value: num.format(data.runs.awaitingApproval) },
    { label: dict.adminAutomations.skipped, value: num.format(data.runs.skipped) },
  ];

  return (
    <div className="scroll-slim h-full overflow-y-auto">
      <div className="mx-auto max-w-4xl px-5 py-8">
        <h1 className="text-2xl font-bold tracking-tight text-ink">{dict.adminAutomations.title}</h1>
        <p className="mt-1 text-sm text-ink-soft">{dict.adminAutomations.subtitle}</p>

        {error && (
          <p className="mt-4 rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger">{error}</p>
        )}

        {/* Kill-switch statuses (read-only) */}
        <h2 className="mt-6 text-sm font-semibold text-ink-soft">{dict.adminAutomations.controls}</h2>
        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          {switches.map((s) => (
            <div key={s.label} className="card flex items-center justify-between p-4">
              <p className="text-sm font-medium text-ink">{s.label}</p>
              <span
                className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                  s.on ? 'bg-success/15 text-success' : 'bg-danger/10 text-danger'
                }`}
              >
                {s.on ? dict.adminAutomations.enabled : dict.adminAutomations.disabled}
              </span>
            </div>
          ))}
        </div>

        {/* Headline metrics */}
        <div className="mt-6 grid gap-3 sm:grid-cols-4">
          <div className="card p-5">
            <p className="text-3xl font-bold text-ink">{num.format(data.runsToday)}</p>
            <p className="mt-1 text-sm text-ink-soft">{dict.adminAutomations.runsToday}</p>
          </div>
          <div className="card p-5">
            <p className="text-3xl font-bold text-ink">{num.format(data.scheduledWrites)}</p>
            <p className="mt-1 text-sm text-ink-soft">{dict.adminAutomations.scheduledWrites}</p>
          </div>
          <div className="card p-5">
            <p className="text-3xl font-bold text-ink">{fmtCost.format(data.avgCost)}</p>
            <p className="mt-1 text-sm text-ink-soft">
              {dict.adminAutomations.avgCost} ({dict.adminAutomations.estimate})
            </p>
          </div>
          <div className="card p-5">
            <p className="text-3xl font-bold text-ink">{num.format(data.queueDepth)}</p>
            <p className="mt-1 text-sm text-ink-soft">{dict.adminAutomations.queueDepth}</p>
          </div>
        </div>

        {/* Scheduler health */}
        <div className="mt-3">
          <div
            className={`card flex items-center justify-between p-4 ${
              data.schedulerHealth.overdue > 0 ? 'border-danger/40' : ''
            }`}
          >
            <p className="text-sm font-medium text-ink">{dict.adminAutomations.schedulerHealth}</p>
            <span
              className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                data.schedulerHealth.overdue > 0 ? 'bg-danger/10 text-danger' : 'bg-success/15 text-success'
              }`}
            >
              {dict.adminAutomations.overdue}: {num.format(data.schedulerHealth.overdue)}
            </span>
          </div>
        </div>

        {/* Workflows breakdown */}
        <h2 className="mt-6 text-sm font-semibold text-ink-soft">{dict.adminAutomations.workflows}</h2>
        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          {wfTiles.map((t) => (
            <div key={t.label} className="rounded-xl border border-line p-4">
              <p className="text-xl font-bold text-ink">{t.value}</p>
              <p className="mt-0.5 text-xs text-ink-soft">{t.label}</p>
            </div>
          ))}
        </div>

        {/* Runs breakdown */}
        <h2 className="mt-6 text-sm font-semibold text-ink-soft">{dict.adminAutomations.runs}</h2>
        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          {runTiles.map((t) => (
            <div key={t.label} className="rounded-xl border border-line p-4">
              <p className="text-xl font-bold text-ink">{t.value}</p>
              <p className="mt-0.5 text-xs text-ink-soft">{t.label}</p>
            </div>
          ))}
        </div>

        {/* Recent runs */}
        <section className="card mt-6 p-5">
          <h2 className="mb-3 text-sm font-semibold text-ink">{dict.adminAutomations.recent}</h2>
          {data.recent.length === 0 ? (
            <p className="text-sm text-ink-faint">{dict.adminAutomations.noData}</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-start text-sm">
                <thead>
                  <tr className="text-xs uppercase tracking-wide text-ink-faint">
                    <th className="px-2 py-1 text-start font-medium">{dict.adminAutomations.workflow}</th>
                    <th className="px-2 py-1 text-start font-medium">{dict.adminAutomations.trigger}</th>
                    <th className="px-2 py-1 text-start font-medium">{dict.adminAutomations.writeActions}</th>
                    <th className="px-2 py-1 text-start font-medium">{dict.adminAutomations.status}</th>
                    <th className="px-2 py-1 text-start font-medium">{dict.adminAutomations.started}</th>
                  </tr>
                </thead>
                <tbody className="text-ink-soft">
                  {data.recent.map((r) => (
                    <tr key={r.id} className="border-t border-line align-top">
                      <td className="max-w-xs px-2 py-2">
                        <code className="text-[11px] text-ink-soft">{r.workflowId.slice(0, 8)}</code>
                      </td>
                      <td className="px-2 py-2">{r.trigger}</td>
                      <td className="px-2 py-2">{num.format(r.writeActions)}</td>
                      <td className="px-2 py-2">
                        <span
                          className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${runStatusClass(r.status)}`}
                        >
                          {runStatusLabel(r.status, dict)}
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
