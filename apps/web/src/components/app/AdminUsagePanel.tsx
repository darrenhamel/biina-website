'use client';

import { useCallback, useEffect, useState } from 'react';
import { Icon } from '@/components/Icon';

interface WindowStat {
  requests: number;
  tokens: number;
  cost: number;
  failed: number;
  fallback: number;
  activeUsers: number;
}
interface Breakdown {
  key: string;
  requests: number;
  tokens: number;
  cost: number;
}
interface UsageData {
  summary: { day: WindowStat; month: WindowStat };
  spend: { day: number; month: number };
  budget: {
    status: 'normal' | 'warning' | 'critical' | 'hard';
    blocked: boolean;
    dayPct: number | null;
    monthPct: number | null;
    currency: string;
    thresholds: {
      currency: string;
      dailyCostWarn: number | null;
      dailyCostHardLimit: number | null;
      monthlyCostWarn: number | null;
      monthlyCostHardLimit: number | null;
      hardLimitEnabled: boolean;
    };
  };
  breakdowns: Record<'provider' | 'model' | 'plan' | 'persona' | 'workload', Breakdown[]>;
  topUsers: Array<{ userId: string | null; email: string | null; plan: string | null; requests: number; tokens: number; cost: number }>;
  modelEconomics: Array<{ model: string; requests: number; avgTtftMs: number; avgLatencyMs: number; tokens: number; cost: number; failureRate: number; costPerRequest: number }>;
}

const nf = new Intl.NumberFormat('en-US');
const money = (n: number, c = 'USD') => `${c === 'USD' ? '$' : ''}${n.toFixed(4)}`;

const budgetTone: Record<string, string> = {
  normal: 'border-line bg-paper-raised text-ink-soft',
  warning: 'border-gold/40 bg-gold/10 text-ink',
  critical: 'border-danger/40 bg-danger/10 text-ink',
  hard: 'border-danger bg-danger/15 text-ink',
};

export function AdminUsagePanel() {
  const [data, setData] = useState<UsageData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [savingBudget, setSavingBudget] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch('/api/admin/ai/usage', { cache: 'no-store' });
      if (!res.ok) throw new Error(`Failed (${res.status})`);
      setData(await res.json());
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const saveBudget = async (patch: Record<string, unknown>) => {
    setSavingBudget(true);
    try {
      await fetch('/api/admin/ai/budget', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch) });
      await load();
    } finally {
      setSavingBudget(false);
    }
  };

  if (!data) {
    return (
      <div className="grid h-full place-items-center">
        {error ? <p className="text-sm text-danger">{error}</p> : <span className="h-6 w-6 animate-spin rounded-full border-2 border-line-strong border-t-accent" />}
      </div>
    );
  }

  const c = data.budget.currency;

  return (
    <div className="scroll-slim h-full overflow-y-auto">
      <div className="mx-auto max-w-4xl px-5 py-8">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-ink">Usage &amp; Cost</h1>
            <p className="mt-1 text-sm text-ink-soft">Estimated internal cost. Not shown to users.</p>
          </div>
          <button onClick={load} className="btn-outline"><Icon name="regenerate" width={14} height={14} /> Refresh</button>
        </div>

        {/* Budget status */}
        <div className={`mt-4 rounded-xl border p-4 ${budgetTone[data.budget.status]}`}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-sm font-semibold">
              Budget: {data.budget.status.toUpperCase()}
              {data.budget.blocked && ' — new AI requests are blocked'}
            </span>
            <span className="text-sm">
              Spend today {money(data.spend.day, c)} · month {money(data.spend.month, c)}
              {data.budget.monthPct != null && ` (${data.budget.monthPct}% of limit)`}
            </span>
          </div>
          <BudgetEditor thresholds={data.budget.thresholds} saving={savingBudget} onSave={saveBudget} />
        </div>

        {/* Summary tiles */}
        <div className="mt-4 grid gap-3 sm:grid-cols-4">
          <Tile label="Requests (today)" value={nf.format(data.summary.day.requests)} sub={`${nf.format(data.summary.month.requests)} this month`} />
          <Tile label="Tokens (today)" value={nf.format(data.summary.day.tokens)} sub={`${nf.format(data.summary.month.tokens)} this month`} />
          <Tile label="Cost (today)" value={money(data.summary.day.cost, c)} sub={`${money(data.summary.month.cost, c)} this month`} />
          <Tile label="Active users (mo)" value={nf.format(data.summary.month.activeUsers)} sub={`${data.summary.month.failed} failed · ${data.summary.month.fallback} fallback`} />
        </div>

        <BreakdownTable title="By provider" rows={data.breakdowns.provider} c={c} />
        <BreakdownTable title="By model" rows={data.breakdowns.model} c={c} />
        <BreakdownTable title="By plan" rows={data.breakdowns.plan} c={c} />
        <BreakdownTable title="By workload" rows={data.breakdowns.workload} c={c} />
        <BreakdownTable title="By persona" rows={data.breakdowns.persona} c={c} />

        {/* Model economics */}
        <Section title="Model economics (this month)">
          <ScrollTable head={['Model', 'Requests', 'Avg TTFT', 'Avg latency', 'Tokens', 'Cost', 'Cost/req', 'Fail %']}>
            {data.modelEconomics.map((m) => (
              <tr key={m.model} className="border-t border-line">
                <Td>{m.model}</Td>
                <Td>{nf.format(m.requests)}</Td>
                <Td>{m.avgTtftMs} ms</Td>
                <Td>{m.avgLatencyMs} ms</Td>
                <Td>{nf.format(m.tokens)}</Td>
                <Td>{money(m.cost, c)}</Td>
                <Td>{money(m.costPerRequest, c)}</Td>
                <Td>{m.failureRate}%</Td>
              </tr>
            ))}
          </ScrollTable>
        </Section>

        {/* Top users */}
        <Section title="Top users (this month)">
          <ScrollTable head={['User', 'Plan', 'Requests', 'Tokens', 'Cost']}>
            {data.topUsers.map((u) => (
              <tr key={u.userId ?? u.email ?? Math.random()} className="border-t border-line">
                <Td>{u.email ?? '(deleted)'}</Td>
                <Td>{u.plan ?? '—'}</Td>
                <Td>{nf.format(u.requests)}</Td>
                <Td>{nf.format(u.tokens)}</Td>
                <Td>{money(u.cost, c)}</Td>
              </tr>
            ))}
          </ScrollTable>
        </Section>
      </div>
    </div>
  );
}

function BudgetEditor({
  thresholds,
  saving,
  onSave,
}: {
  thresholds: UsageData['budget']['thresholds'];
  saving: boolean;
  onSave: (patch: Record<string, unknown>) => void;
}) {
  const [monthly, setMonthly] = useState(thresholds.monthlyCostHardLimit?.toString() ?? '');
  const [warn, setWarn] = useState(thresholds.monthlyCostWarn?.toString() ?? '');
  const [hard, setHard] = useState(thresholds.hardLimitEnabled);
  return (
    <div className="mt-3 flex flex-wrap items-end gap-3 border-t border-line/50 pt-3 text-sm">
      <label className="flex flex-col">
        <span className="text-xs text-ink-soft">Monthly warn</span>
        <input value={warn} onChange={(e) => setWarn(e.target.value)} className="field w-28 py-1.5" inputMode="decimal" />
      </label>
      <label className="flex flex-col">
        <span className="text-xs text-ink-soft">Monthly hard limit</span>
        <input value={monthly} onChange={(e) => setMonthly(e.target.value)} className="field w-28 py-1.5" inputMode="decimal" />
      </label>
      <label className="inline-flex items-center gap-1.5 pb-2 text-xs text-ink-soft">
        <input type="checkbox" checked={hard} onChange={(e) => setHard(e.target.checked)} className="h-4 w-4 accent-[rgb(var(--c-accent))]" />
        Enforce hard limit
      </label>
      <button
        disabled={saving}
        onClick={() =>
          onSave({
            monthlyCostWarn: warn === '' ? null : Number(warn),
            monthlyCostHardLimit: monthly === '' ? null : Number(monthly),
            hardLimitEnabled: hard,
          })
        }
        className="btn-primary py-1.5"
      >
        Save budget
      </button>
    </div>
  );
}

function BreakdownTable({ title, rows, c }: { title: string; rows: Breakdown[]; c: string }) {
  if (!rows.length) return null;
  return (
    <Section title={title}>
      <ScrollTable head={['', 'Requests', 'Tokens', 'Cost']}>
        {rows.map((r) => (
          <tr key={r.key} className="border-t border-line">
            <Td>{r.key}</Td>
            <Td>{nf.format(r.requests)}</Td>
            <Td>{nf.format(r.tokens)}</Td>
            <Td>{money(r.cost, c)}</Td>
          </tr>
        ))}
      </ScrollTable>
    </Section>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="card mt-4 p-5">
      <h2 className="mb-3 text-sm font-semibold text-ink">{title}</h2>
      {children}
    </section>
  );
}
function Tile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-xl border border-line p-4">
      <p className="truncate text-lg font-bold text-ink">{value}</p>
      <p className="mt-0.5 text-xs text-ink-soft">{label}</p>
      {sub && <p className="mt-1 text-[11px] text-ink-faint">{sub}</p>}
    </div>
  );
}
function ScrollTable({ head, children }: { head: string[]; children: React.ReactNode }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-start text-sm">
        <thead>
          <tr className="text-xs uppercase tracking-wide text-ink-faint">
            {head.map((h, i) => <th key={i} className="px-2 py-1 text-start font-medium">{h}</th>)}
          </tr>
        </thead>
        <tbody className="text-ink-soft">{children}</tbody>
      </table>
    </div>
  );
}
function Td({ children }: { children: React.ReactNode }) {
  return <td className="whitespace-nowrap px-2 py-1.5">{children}</td>;
}
