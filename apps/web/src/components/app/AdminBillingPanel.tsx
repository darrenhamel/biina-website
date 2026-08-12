'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import type { Locale } from '@/i18n/config';
import type { Dictionary } from '@/i18n/dictionaries';

interface Overview {
  billingEnabled: boolean;
  liveMode: boolean;
  counts: {
    active: number;
    trialing: number;
    pastDue: number;
    canceled: number;
    unpaid: number;
    total: number;
  };
  mrr: { currency: string; mrr: number; arr: number }[];
  changes: { newSubscriptions30d: number; cancellations30d: number };
  unitEconomics: {
    planSlug: string;
    subscribers: number;
    revenueByCurrency: Record<string, number>;
    aiCostUsdMonth: number;
  }[];
  freeCost: { freeUsers: number; aiCostUsdMonth: number };
}

interface PriceRow {
  id: string;
  planSlug: string;
  displayName: string;
  currency: string;
  amount: number;
  billingInterval: string;
  billingIntervalCount?: number;
  trialDays?: number;
  providerPriceId?: string;
  enabled?: boolean;
  isPublic?: boolean;
  public?: boolean;
}

interface BillingConfig {
  defaultCurrency: string;
  taxEnabled: boolean;
  taxMode: string;
  taxInclusive?: boolean;
  taxRegistrationNumber: string;
  taxRateReference?: string;
  legalEntityName: string;
  billingCountry: string;
  supportEmail: string;
}

const PLAN_SLUGS = ['FREE', 'PRO', 'BUSINESS', 'ENTERPRISE', 'ADMIN'];

export function AdminBillingPanel({ locale, dict }: { locale: Locale; dict: Dictionary }) {
  const [overview, setOverview] = useState<Overview | null>(null);
  const [prices, setPrices] = useState<PriceRow[]>([]);
  const [config, setConfig] = useState<BillingConfig | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [reconcileNote, setReconcileNote] = useState<string | null>(null);

  const usd = (amount: number) =>
    new Intl.NumberFormat(locale === 'ar' ? 'ar-AE' : 'en-US', {
      style: 'currency',
      currency: 'USD',
    }).format(amount);

  const money = (minor: number, currency: string) =>
    new Intl.NumberFormat(locale === 'ar' ? 'ar-AE' : 'en-US', {
      style: 'currency',
      currency,
    }).format(minor / 100);

  const loadOverview = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/billing', { cache: 'no-store' });
      if (!res.ok) throw new Error();
      setOverview((await res.json()) as Overview);
    } catch {
      setError(dict.common.somethingWrong);
    }
  }, [dict]);

  const loadPrices = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/billing/prices', { cache: 'no-store' });
      if (!res.ok) throw new Error();
      const data = await res.json();
      setPrices((data.prices ?? []) as PriceRow[]);
    } catch {
      setError(dict.common.somethingWrong);
    }
  }, [dict]);

  const loadConfig = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/billing/config', { cache: 'no-store' });
      if (!res.ok) throw new Error();
      const data = await res.json();
      setConfig(data.config as BillingConfig);
    } catch {
      setError(dict.common.somethingWrong);
    }
  }, [dict]);

  useEffect(() => {
    void loadOverview();
    void loadPrices();
    void loadConfig();
  }, [loadOverview, loadPrices, loadConfig]);

  async function togglePrice(row: PriceRow) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/billing/prices/${row.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: !row.enabled }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error || dict.common.somethingWrong);
      }
      await loadPrices();
    } finally {
      setBusy(false);
    }
  }

  async function reconcile() {
    setBusy(true);
    setError(null);
    setReconcileNote(null);
    try {
      const res = await fetch('/api/admin/billing/reconcile', { method: 'POST' });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error || dict.common.somethingWrong);
        return;
      }
      const data = await res.json();
      const drift = Array.isArray(data.drift) ? data.drift.length : 0;
      setReconcileNote(`${dict.adminBilling.reconciled} (${drift})`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="scroll-slim h-full overflow-y-auto">
      <div className="mx-auto max-w-4xl px-5 py-8">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-ink">{dict.adminBilling.title}</h1>
            <p className="mt-1 text-sm text-ink-soft">{dict.adminBilling.subtitle}</p>
          </div>
          {overview && (
            <span
              className={`rounded-full px-2.5 py-1 text-xs font-medium ${
                overview.liveMode ? 'bg-accent-soft text-accent' : 'bg-paper-sunken text-ink-soft'
              }`}
            >
              {overview.liveMode ? dict.adminBilling.liveMode : dict.adminBilling.testMode}
            </span>
          )}
        </div>

        {error && (
          <p className="mt-4 rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger">{error}</p>
        )}

        {overview && (
          <>
            <p className="mt-4 text-xs text-ink-faint">{dict.adminBilling.estimateNote}</p>

            <div className="mt-3 grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
              <StatTile label={dict.adminBilling.activeSubs} value={overview.counts.active} />
              <StatTile label={dict.adminBilling.trials} value={overview.counts.trialing} />
              <StatTile label={dict.adminBilling.pastDue} value={overview.counts.pastDue} />
              <StatTile label={dict.adminBilling.canceled} value={overview.counts.canceled} />
              <StatTile
                label={dict.adminBilling.newSubs}
                value={overview.changes.newSubscriptions30d}
              />
              <StatTile
                label={dict.adminBilling.cancellations}
                value={overview.changes.cancellations30d}
              />
            </div>

            {/* MRR / ARR */}
            {overview.mrr.length > 0 && (
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <div className="card p-5">
                  <p className="text-sm text-ink-soft">{dict.adminBilling.mrr}</p>
                  <ul className="mt-2 space-y-1">
                    {overview.mrr.map((m) => (
                      <li key={`mrr-${m.currency}`} className="text-lg font-bold text-ink">
                        {money(m.mrr, m.currency)}
                      </li>
                    ))}
                  </ul>
                </div>
                <div className="card p-5">
                  <p className="text-sm text-ink-soft">{dict.adminBilling.arr}</p>
                  <ul className="mt-2 space-y-1">
                    {overview.mrr.map((m) => (
                      <li key={`arr-${m.currency}`} className="text-lg font-bold text-ink">
                        {money(m.arr, m.currency)}
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            )}

            {/* Unit economics */}
            <section className="card mt-6 p-5">
              <h2 className="text-sm font-semibold text-ink">{dict.adminBilling.unitEconomics}</h2>
              <p className="mt-1 text-xs text-ink-faint">{dict.adminBilling.currenciesNote}</p>
              <div className="mt-3 overflow-x-auto">
                <table className="w-full text-start text-sm">
                  <thead>
                    <tr className="text-xs uppercase tracking-wide text-ink-faint">
                      <th className="px-2 py-1 text-start font-medium">{dict.adminBilling.plan}</th>
                      <th className="px-2 py-1 text-start font-medium">
                        {dict.adminBilling.subscribers}
                      </th>
                      <th className="px-2 py-1 text-start font-medium">
                        {dict.adminBilling.revenue}
                      </th>
                      <th className="px-2 py-1 text-start font-medium">{dict.adminBilling.aiCost}</th>
                    </tr>
                  </thead>
                  <tbody className="text-ink-soft">
                    {overview.unitEconomics.map((u) => (
                      <tr key={u.planSlug} className="border-t border-line align-top">
                        <td className="px-2 py-2 text-ink">{u.planSlug}</td>
                        <td className="px-2 py-2">{u.subscribers}</td>
                        <td className="px-2 py-2">
                          {Object.entries(u.revenueByCurrency).length === 0
                            ? '—'
                            : Object.entries(u.revenueByCurrency).map(([cur, minor]) => (
                                <span key={cur} className="block text-ink">
                                  {money(minor, cur)}
                                </span>
                              ))}
                        </td>
                        <td className="px-2 py-2">{usd(u.aiCostUsdMonth)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>

            {/* Free-user cost */}
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <StatTile label={dict.adminBilling.freeUsers} value={overview.freeCost.freeUsers} />
              <div className="card p-5">
                <p className="text-3xl font-bold text-ink">{usd(overview.freeCost.aiCostUsdMonth)}</p>
                <p className="mt-1 text-sm text-ink-soft">{dict.adminBilling.freeUserCost}</p>
              </div>
            </div>
          </>
        )}

        {/* Commercial prices */}
        <section className="card mt-6 p-5">
          <h2 className="text-sm font-semibold text-ink">{dict.adminBilling.prices}</h2>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-start text-sm">
              <thead>
                <tr className="text-xs uppercase tracking-wide text-ink-faint">
                  <th className="px-2 py-1 text-start font-medium">{dict.adminBilling.plan}</th>
                  <th className="px-2 py-1 text-start font-medium">{dict.common.displayName}</th>
                  <th className="px-2 py-1 text-start font-medium">{dict.billing.amount}</th>
                  <th className="px-2 py-1 text-start font-medium">{dict.adminBilling.interval}</th>
                  <th className="px-2 py-1 text-start font-medium">
                    {dict.adminBilling.providerPrice}
                  </th>
                  <th className="px-2 py-1 text-start font-medium">{dict.adminBilling.publicLabel}</th>
                  <th className="px-2 py-1 text-start font-medium">
                    {dict.adminBilling.enabledLabel}
                  </th>
                </tr>
              </thead>
              <tbody className="text-ink-soft">
                {prices.map((p) => {
                  const isPublic = p.isPublic ?? p.public ?? false;
                  return (
                    <tr key={p.id} className="border-t border-line align-top">
                      <td className="px-2 py-2 text-ink">{p.planSlug}</td>
                      <td className="px-2 py-2">{p.displayName}</td>
                      <td className="px-2 py-2 text-ink">{money(p.amount, p.currency)}</td>
                      <td className="px-2 py-2">
                        {p.billingInterval}
                        {p.billingIntervalCount && p.billingIntervalCount > 1
                          ? ` ×${p.billingIntervalCount}`
                          : ''}
                      </td>
                      <td className="px-2 py-2 font-mono text-xs">{p.providerPriceId || '—'}</td>
                      <td className="px-2 py-2">
                        {isPublic ? dict.adminUsers.yes : dict.adminUsers.no}
                      </td>
                      <td className="px-2 py-2">
                        <button
                          onClick={() => togglePrice(p)}
                          className="btn-ghost"
                          disabled={busy}
                        >
                          {p.enabled ? dict.adminUsers.yes : dict.adminUsers.no}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <AddPriceForm dict={dict} busy={busy} setBusy={setBusy} setError={setError} onDone={loadPrices} />
        </section>

        {/* Tax / config */}
        {config && (
          <ConfigForm
            dict={dict}
            config={config}
            busy={busy}
            setBusy={setBusy}
            setError={setError}
            onSaved={loadConfig}
          />
        )}

        {/* Reconcile */}
        <section className="card mt-6 p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-sm font-semibold text-ink">{dict.adminBilling.reconcile}</h2>
            <button onClick={reconcile} className="btn" disabled={busy}>
              {dict.adminBilling.reconcile}
            </button>
          </div>
          {reconcileNote && (
            <p className="mt-3 rounded-lg bg-paper-sunken px-3 py-2 text-sm text-ink-soft">
              {reconcileNote}
            </p>
          )}
        </section>
      </div>
    </div>
  );
}

function StatTile({ label, value }: { label: string; value: number }) {
  return (
    <div className="card p-5">
      <p className="text-3xl font-bold text-ink">{value}</p>
      <p className="mt-1 text-sm text-ink-soft">{label}</p>
    </div>
  );
}

function AddPriceForm({
  dict,
  busy,
  setBusy,
  setError,
  onDone,
}: {
  dict: Dictionary;
  busy: boolean;
  setBusy: (v: boolean) => void;
  setError: (v: string | null) => void;
  onDone: () => Promise<void>;
}) {
  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formEl = e.currentTarget;
    const form = new FormData(formEl);
    const trialDaysRaw = String(form.get('trialDays') ?? '').trim();
    const payload: Record<string, unknown> = {
      planSlug: String(form.get('planSlug') ?? ''),
      displayName: String(form.get('displayName') ?? ''),
      providerPriceId: String(form.get('providerPriceId') ?? ''),
      currency: String(form.get('currency') ?? ''),
      amount: Number(form.get('amount') ?? 0),
      billingInterval: String(form.get('billingInterval') ?? 'month'),
      billingIntervalCount: Number(form.get('billingIntervalCount') ?? 1),
    };
    if (trialDaysRaw) payload.trialDays = Number(trialDaysRaw);

    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/admin/billing/prices', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error || dict.common.somethingWrong);
        return;
      }
      formEl.reset();
      await onDone();
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="mt-5 border-t border-line pt-5">
      <h3 className="text-sm font-semibold text-ink">{dict.adminBilling.addPrice}</h3>
      <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <label className="block">
          <span className="mb-1.5 block text-sm text-ink-soft">{dict.adminBilling.plan}</span>
          <select name="planSlug" className="field" defaultValue="PRO">
            {PLAN_SLUGS.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="mb-1.5 block text-sm text-ink-soft">{dict.common.displayName}</span>
          <input name="displayName" className="field" required />
        </label>
        <label className="block">
          <span className="mb-1.5 block text-sm text-ink-soft">
            {dict.adminBilling.providerPrice}
          </span>
          <input name="providerPriceId" className="field" required />
        </label>
        <label className="block">
          <span className="mb-1.5 block text-sm text-ink-soft">{dict.billing.amount}</span>
          <input name="amount" type="number" min={0} step={1} className="field" required />
        </label>
        <label className="block">
          <span className="mb-1.5 block text-sm text-ink-soft">{dict.adminBilling.config}</span>
          <input
            name="currency"
            maxLength={3}
            minLength={3}
            className="field uppercase"
            defaultValue="AED"
            required
          />
        </label>
        <label className="block">
          <span className="mb-1.5 block text-sm text-ink-soft">{dict.adminBilling.interval}</span>
          <select name="billingInterval" className="field" defaultValue="month">
            <option value="month">{dict.pricing.billedMonthly}</option>
            <option value="year">{dict.pricing.billedAnnual}</option>
          </select>
        </label>
        <label className="block">
          <span className="mb-1.5 block text-sm text-ink-soft">{dict.adminBilling.interval}</span>
          <input name="billingIntervalCount" type="number" min={1} step={1} className="field" defaultValue={1} />
        </label>
        <label className="block">
          <span className="mb-1.5 block text-sm text-ink-soft">{dict.pricing.trialDays}</span>
          <input name="trialDays" type="number" min={0} step={1} className="field" />
        </label>
      </div>
      <button type="submit" className="btn-primary mt-4" disabled={busy}>
        {dict.adminBilling.addPrice}
      </button>
    </form>
  );
}

function ConfigForm({
  dict,
  config,
  busy,
  setBusy,
  setError,
  onSaved,
}: {
  dict: Dictionary;
  config: BillingConfig;
  busy: boolean;
  setBusy: (v: boolean) => void;
  setError: (v: string | null) => void;
  onSaved: () => Promise<void>;
}) {
  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const payload = {
      defaultCurrency: String(form.get('defaultCurrency') ?? ''),
      taxEnabled: form.get('taxEnabled') === 'on',
      taxMode: String(form.get('taxMode') ?? 'none'),
      taxRegistrationNumber: String(form.get('taxRegistrationNumber') ?? ''),
      legalEntityName: String(form.get('legalEntityName') ?? ''),
      billingCountry: String(form.get('billingCountry') ?? ''),
      supportEmail: String(form.get('supportEmail') ?? ''),
    };
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/admin/billing/config', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error || dict.common.somethingWrong);
        return;
      }
      await onSaved();
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card mt-6 p-5">
      <h2 className="text-sm font-semibold text-ink">{dict.adminBilling.config}</h2>
      <p className="mt-2 rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger">
        {dict.adminBilling.taxWarning}
      </p>
      <form onSubmit={onSubmit} className="mt-4 grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="mb-1.5 block text-sm text-ink-soft">{dict.adminBilling.config}</span>
          <input
            name="defaultCurrency"
            maxLength={3}
            minLength={3}
            className="field uppercase"
            defaultValue={config.defaultCurrency}
          />
        </label>
        <label className="block">
          <span className="mb-1.5 block text-sm text-ink-soft">{dict.adminBilling.config}</span>
          <select name="taxMode" className="field" defaultValue={config.taxMode || 'none'}>
            <option value="none">none</option>
            <option value="inclusive">inclusive</option>
            <option value="exclusive">exclusive</option>
          </select>
        </label>
        <label className="flex items-center gap-2 sm:col-span-2">
          <input
            name="taxEnabled"
            type="checkbox"
            defaultChecked={config.taxEnabled}
            className="h-4 w-4 rounded border-line"
          />
          <span className="text-sm text-ink-soft">{dict.adminBilling.config}</span>
        </label>
        <label className="block">
          <span className="mb-1.5 block text-sm text-ink-soft">{dict.adminBilling.config}</span>
          <input
            name="taxRegistrationNumber"
            className="field"
            defaultValue={config.taxRegistrationNumber}
          />
        </label>
        <label className="block">
          <span className="mb-1.5 block text-sm text-ink-soft">{dict.common.displayName}</span>
          <input name="legalEntityName" className="field" defaultValue={config.legalEntityName} />
        </label>
        <label className="block">
          <span className="mb-1.5 block text-sm text-ink-soft">{dict.adminBilling.config}</span>
          <input name="billingCountry" className="field" defaultValue={config.billingCountry} />
        </label>
        <label className="block">
          <span className="mb-1.5 block text-sm text-ink-soft">{dict.common.email}</span>
          <input name="supportEmail" type="email" className="field" defaultValue={config.supportEmail} />
        </label>
        <div className="sm:col-span-2">
          <button type="submit" className="btn-primary" disabled={busy}>
            {dict.common.save}
          </button>
        </div>
      </form>
    </section>
  );
}
