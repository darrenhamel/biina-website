'use client';

import { useCallback, useEffect, useState } from 'react';
import { Icon } from '@/components/Icon';

interface Plan {
  slug: string;
  displayName: string;
  enabled: boolean;
  dailyRequestLimit: number | null;
  monthlyRequestLimit: number | null;
  dailyTokenLimit: number | null;
  monthlyTokenLimit: number | null;
  requestsPerMinute: number | null;
  maxConcurrent: number | null;
  maxContextTokens: number | null;
  maxOutputTokens: number | null;
  priorityClass: number;
}
interface UserRow {
  id: string;
  email: string;
  role: string;
  plan: string;
  createdAt: string;
}

const PLAN_SLUGS = ['FREE', 'PRO', 'BUSINESS', 'ENTERPRISE', 'ADMIN'];
const NUM_FIELDS: Array<[keyof Plan, string]> = [
  ['monthlyRequestLimit', 'Monthly requests'],
  ['dailyRequestLimit', 'Daily requests'],
  ['monthlyTokenLimit', 'Monthly tokens'],
  ['dailyTokenLimit', 'Daily tokens'],
  ['requestsPerMinute', 'Req/min'],
  ['maxConcurrent', 'Concurrent'],
  ['maxContextTokens', 'Max context'],
  ['maxOutputTokens', 'Max output'],
];

export function AdminPlansPanel() {
  const [plans, setPlans] = useState<Plan[]>([]);
  const [users, setUsers] = useState<UserRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [p, u] = await Promise.all([
        fetch('/api/admin/ai/plans', { cache: 'no-store' }).then((r) => r.json()),
        fetch('/api/admin/ai/users', { cache: 'no-store' }).then((r) => r.json()),
      ]);
      setPlans(p.plans ?? []);
      setUsers(u.users ?? []);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const savePlan = async (slug: string, patch: Record<string, unknown>) => {
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/ai/plans/${slug}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch) });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Save failed');
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const assignPlan = async (userId: string, plan: string) => {
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/ai/users/${userId}/plan`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ plan }) });
      if (!res.ok) throw new Error('Assign failed');
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="scroll-slim h-full overflow-y-auto">
      <div className="mx-auto max-w-4xl px-5 py-8">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold tracking-tight text-ink">Plans</h1>
          <button onClick={load} className="btn-outline"><Icon name="regenerate" width={14} height={14} /> Refresh</button>
        </div>
        <p className="mt-1 text-sm text-ink-soft">Initial configuration — placeholder limits, not final pricing. Null = unlimited.</p>
        {error && <p className="mt-3 rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger">{error}</p>}

        {plans.map((p) => (
          <PlanCard key={p.slug} plan={p} busy={busy} onSave={(patch) => savePlan(p.slug, patch)} />
        ))}

        <section className="card mt-4 p-5">
          <h2 className="mb-3 text-sm font-semibold text-ink">Users</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-start text-sm">
              <thead>
                <tr className="text-xs uppercase tracking-wide text-ink-faint">
                  <th className="px-2 py-1 text-start font-medium">Email</th>
                  <th className="px-2 py-1 text-start font-medium">Role</th>
                  <th className="px-2 py-1 text-start font-medium">Plan</th>
                </tr>
              </thead>
              <tbody className="text-ink-soft">
                {users.map((u) => (
                  <tr key={u.id} className="border-t border-line">
                    <td className="px-2 py-1.5">{u.email}</td>
                    <td className="px-2 py-1.5">{u.role}</td>
                    <td className="px-2 py-1.5">
                      <select
                        value={u.plan}
                        disabled={busy}
                        onChange={(e) => assignPlan(u.id, e.target.value)}
                        className="rounded-lg border border-line bg-paper-raised px-2 py-1 text-xs text-ink focus:border-accent focus:outline-none"
                      >
                        {PLAN_SLUGS.map((s) => <option key={s} value={s}>{s}</option>)}
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </div>
  );
}

function PlanCard({ plan, busy, onSave }: { plan: Plan; busy: boolean; onSave: (patch: Record<string, unknown>) => void }) {
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(NUM_FIELDS.map(([k]) => [k, plan[k] == null ? '' : String(plan[k])])),
  );
  const [enabled, setEnabled] = useState(plan.enabled);

  const save = () => {
    const patch: Record<string, unknown> = { enabled };
    for (const [k] of NUM_FIELDS) patch[k] = values[k] === '' ? null : Number(values[k]);
    onSave(patch);
  };

  return (
    <section className="card mt-4 p-5">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-ink">{plan.displayName} <span className="text-xs font-normal text-ink-faint">{plan.slug}</span></h2>
        <label className="inline-flex items-center gap-1.5 text-xs text-ink-soft">
          <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} className="h-4 w-4 accent-[rgb(var(--c-accent))]" />
          Enabled
        </label>
      </div>
      <div className="mt-3 grid gap-2 sm:grid-cols-4">
        {NUM_FIELDS.map(([k, label]) => (
          <label key={String(k)} className="flex flex-col">
            <span className="text-xs text-ink-soft">{label}</span>
            <input
              value={values[k as string]}
              onChange={(e) => setValues((s) => ({ ...s, [k]: e.target.value }))}
              placeholder="∞"
              inputMode="numeric"
              className="field py-1.5"
            />
          </label>
        ))}
      </div>
      <button onClick={save} disabled={busy} className="btn-primary mt-3 py-1.5">Save {plan.slug}</button>
    </section>
  );
}
