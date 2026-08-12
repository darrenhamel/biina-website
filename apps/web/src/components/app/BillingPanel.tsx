'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import type { Locale } from '@/i18n/config';
import type { Dictionary } from '@/i18n/dictionaries';

type SubStatus =
  | 'active'
  | 'trialing'
  | 'past_due'
  | 'canceled'
  | 'unpaid'
  | 'paused'
  | 'incomplete'
  | string;

interface Subscription {
  id: string;
  planSlug: string;
  status: SubStatus;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  trialEnd: string | null;
}

interface Invoice {
  id: string;
  status: string;
  total: number;
  currency: string;
  createdAt: string;
  invoiceUrl: string | null;
}

interface Summary {
  plan: string;
  billingEnabled: boolean;
  hasBillingAccount: boolean;
  subscription: Subscription | null;
  invoices: Invoice[];
}

export function BillingPanel({ locale, dict }: { locale: Locale; dict: Dictionary }) {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch('/api/billing/summary', { cache: 'no-store' });
      if (!res.ok) throw new Error();
      const data = (await res.json()) as Summary;
      setSummary(data);
    } catch {
      setError(dict.common.somethingWrong);
    }
  }, [dict]);

  useEffect(() => {
    void load();
  }, [load]);

  const dateFmt = new Intl.DateTimeFormat(locale === 'ar' ? 'ar-AE' : 'en-US', {
    dateStyle: 'medium',
  });
  const money = (amount: number, currency: string) =>
    new Intl.NumberFormat(locale === 'ar' ? 'ar-AE' : 'en-US', {
      style: 'currency',
      currency,
    }).format(amount / 100);

  function statusLabel(status: SubStatus): string {
    switch (status) {
      case 'active':
        return dict.billing.statusActive;
      case 'trialing':
        return dict.billing.statusTrialing;
      case 'past_due':
        return dict.billing.statusPastDue;
      case 'canceled':
        return dict.billing.statusCanceled;
      case 'unpaid':
        return dict.billing.statusUnpaid;
      case 'paused':
        return dict.billing.statusPaused;
      case 'incomplete':
        return dict.billing.statusIncomplete;
      default:
        return status;
    }
  }

  async function post(path: string, body?: unknown) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined,
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error || dict.common.somethingWrong);
        return null;
      }
      return (await res.json().catch(() => ({}))) as Record<string, unknown>;
    } catch {
      setError(dict.common.somethingWrong);
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function manageBilling() {
    const data = await post('/api/billing/portal');
    if (data && typeof data.url === 'string') window.location.href = data.url;
  }

  async function cancel(subscriptionId: string) {
    if (!window.confirm(dict.billing.cancelConfirm)) return;
    const data = await post('/api/billing/subscription/cancel', {
      subscriptionId,
      atPeriodEnd: true,
    });
    if (data) await load();
  }

  async function resume(subscriptionId: string) {
    const data = await post('/api/billing/subscription/resume', { subscriptionId });
    if (data) await load();
  }

  const sub = summary?.subscription ?? null;

  return (
    <div className="scroll-slim h-full overflow-y-auto">
      <div className="mx-auto max-w-2xl px-5 py-8">
        <h1 className="text-2xl font-bold tracking-tight text-ink">{dict.billing.title}</h1>
        <p className="mt-1 text-sm text-ink-soft">{dict.billing.subtitle}</p>

        {error && (
          <p className="mt-4 rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger">{error}</p>
        )}

        {summary && (
          <div className="mt-6 space-y-6">
            {/* Current plan */}
            <section className="card p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 className="text-sm font-semibold text-ink">{dict.billing.currentPlan}</h2>
                  <p className="mt-1 text-2xl font-bold text-ink">{summary.plan}</p>
                  {sub && (
                    <p className="mt-1 text-sm text-ink-soft">
                      {dict.billing.status}: {statusLabel(sub.status)}
                    </p>
                  )}
                </div>
                <Link href={`/${locale}/pricing`} className="btn">
                  {dict.billing.viewPlans}
                </Link>
              </div>

              {sub && (
                <div className="mt-4 space-y-1 text-sm text-ink-soft">
                  {sub.trialEnd && (
                    <p>
                      {dict.billing.trialEnds}: {dateFmt.format(new Date(sub.trialEnd))}
                    </p>
                  )}
                  {sub.currentPeriodEnd && (
                    <p>
                      {dict.billing.renews}: {dateFmt.format(new Date(sub.currentPeriodEnd))}
                    </p>
                  )}
                  {sub.cancelAtPeriodEnd && (
                    <p className="font-medium text-danger">{dict.billing.cancelAtEnd}</p>
                  )}
                </div>
              )}

              {!summary.billingEnabled ? (
                <p className="mt-4 rounded-lg bg-paper-sunken px-3 py-2 text-sm text-ink-soft">
                  {dict.billing.disabledNote}
                </p>
              ) : (
                <div className="mt-4 flex flex-wrap gap-2">
                  {summary.hasBillingAccount && (
                    <button onClick={manageBilling} className="btn" disabled={busy}>
                      {dict.billing.manageBilling}
                    </button>
                  )}
                  {sub && sub.status !== 'canceled' && !sub.cancelAtPeriodEnd && (
                    <button
                      onClick={() => cancel(sub.id)}
                      className="btn-ghost text-danger"
                      disabled={busy}
                    >
                      {dict.billing.cancel}
                    </button>
                  )}
                  {sub && sub.cancelAtPeriodEnd && (
                    <button
                      onClick={() => resume(sub.id)}
                      className="btn-ghost text-accent"
                      disabled={busy}
                    >
                      {dict.billing.resume}
                    </button>
                  )}
                </div>
              )}

              {!sub && (
                <p className="mt-4 text-sm text-ink-soft">{dict.billing.noSubscription}</p>
              )}
            </section>

            {/* Invoices */}
            <section className="card p-5">
              <h2 className="text-sm font-semibold text-ink">{dict.billing.invoices}</h2>
              {summary.invoices.length === 0 ? (
                <p className="mt-3 text-sm text-ink-soft">{dict.billing.noInvoices}</p>
              ) : (
                <div className="mt-3 overflow-x-auto">
                  <table className="w-full text-start text-sm">
                    <thead>
                      <tr className="text-xs uppercase tracking-wide text-ink-faint">
                        <th className="px-2 py-1 text-start font-medium">{dict.billing.date}</th>
                        <th className="px-2 py-1 text-start font-medium">{dict.billing.amount}</th>
                        <th className="px-2 py-1 text-start font-medium">{dict.billing.status}</th>
                        <th className="px-2 py-1 text-start font-medium" />
                      </tr>
                    </thead>
                    <tbody className="text-ink-soft">
                      {summary.invoices.map((inv) => (
                        <tr key={inv.id} className="border-t border-line">
                          <td className="px-2 py-2">{dateFmt.format(new Date(inv.createdAt))}</td>
                          <td className="px-2 py-2 text-ink">{money(inv.total, inv.currency)}</td>
                          <td className="px-2 py-2">{inv.status}</td>
                          <td className="px-2 py-2">
                            {inv.invoiceUrl && (
                              <a
                                href={inv.invoiceUrl}
                                target="_blank"
                                rel="noreferrer"
                                className="font-semibold text-accent hover:underline"
                              >
                                {dict.billing.viewInvoice}
                              </a>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          </div>
        )}
      </div>
    </div>
  );
}
