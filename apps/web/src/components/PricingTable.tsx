'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import type { Locale } from '@/i18n/config';
import type { Dictionary } from '@/i18n/dictionaries';

interface Price {
  id: string;
  planSlug: string;
  displayName: string;
  currency: string;
  amount: number;
  billingInterval: string;
  billingIntervalCount: number;
  trialDays: number;
  isTest: boolean;
}

type Notice =
  | { kind: 'signin' }
  | { kind: 'disabled' }
  | { kind: 'error'; message: string };

export function PricingTable({ locale, dict }: { locale: Locale; dict: Dictionary }) {
  const [prices, setPrices] = useState<Price[]>([]);
  const [billingEnabled, setBillingEnabled] = useState(true);
  const [interval, setInterval] = useState<'month' | 'year'>('month');
  const [loadError, setLoadError] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [busyPriceId, setBusyPriceId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      const res = await fetch('/api/billing/prices', { cache: 'no-store' });
      if (!res.ok) throw new Error();
      const data = await res.json();
      setPrices(data.prices ?? []);
      setBillingEnabled(Boolean(data.billingEnabled));
    } catch {
      setLoadError(dict.common.somethingWrong);
    }
  }, [dict]);

  useEffect(() => {
    void load();
  }, [load]);

  const money = useCallback(
    (amount: number, currency: string) =>
      new Intl.NumberFormat(locale === 'ar' ? 'ar-AE' : 'en-US', {
        style: 'currency',
        currency,
      }).format(amount / 100),
    [locale],
  );

  function priceFor(slug: string): Price | undefined {
    const forSlug = prices.filter((p) => p.planSlug.toUpperCase() === slug);
    return forSlug.find((p) => p.billingInterval === interval) ?? forSlug[0];
  }

  const hasTestPrice = prices.some((p) => p.isTest);

  async function subscribe(priceId: string) {
    setNotice(null);
    setBusyPriceId(priceId);
    try {
      const res = await fetch('/api/billing/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ commercialPriceId: priceId }),
      });
      if (res.status === 401) {
        setNotice({ kind: 'signin' });
        return;
      }
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        if (data.code === 'billing_disabled') {
          setNotice({ kind: 'disabled' });
          return;
        }
        setNotice({ kind: 'error', message: data.error || dict.common.somethingWrong });
        return;
      }
      const data = await res.json();
      if (data.url) window.location.href = data.url;
    } catch {
      setNotice({ kind: 'error', message: dict.common.somethingWrong });
    } finally {
      setBusyPriceId(null);
    }
  }

  const suffix = interval === 'year' ? dict.pricing.perYear : dict.pricing.perMonth;

  return (
    <div>
      {/* Monthly / annual toggle */}
      <div className="flex justify-center">
        <div className="inline-flex rounded-full border border-line bg-paper-raised p-1 text-sm">
          <button
            type="button"
            onClick={() => setInterval('month')}
            className={`rounded-full px-4 py-1.5 font-medium transition-colors ${
              interval === 'month' ? 'bg-accent text-on-accent' : 'text-ink-soft hover:text-ink'
            }`}
          >
            {dict.pricing.billedMonthly}
          </button>
          <button
            type="button"
            onClick={() => setInterval('year')}
            className={`rounded-full px-4 py-1.5 font-medium transition-colors ${
              interval === 'year' ? 'bg-accent text-on-accent' : 'text-ink-soft hover:text-ink'
            }`}
          >
            {dict.pricing.billedAnnual}
          </button>
        </div>
      </div>

      {loadError && (
        <p className="mt-6 rounded-lg bg-danger/10 px-3 py-2 text-center text-sm text-danger">
          {loadError}
        </p>
      )}

      {(!billingEnabled || hasTestPrice) && (
        <p className="mx-auto mt-6 max-w-2xl rounded-lg bg-paper-sunken px-3 py-2 text-center text-sm text-ink-soft">
          {billingEnabled ? dict.pricing.testModeNote : dict.pricing.billingComingSoon}
        </p>
      )}

      {notice && (
        <div className="mx-auto mt-6 max-w-2xl rounded-lg bg-paper-sunken px-3 py-2 text-center text-sm text-ink-soft">
          {notice.kind === 'signin' && (
            <>
              {dict.pricing.needSignin}{' '}
              <Link
                href={`/${locale}/login?next=/${locale}/pricing`}
                className="font-semibold text-accent hover:underline"
              >
                {dict.common.signIn}
              </Link>
            </>
          )}
          {notice.kind === 'disabled' && dict.pricing.billingComingSoon}
          {notice.kind === 'error' && <span className="text-danger">{notice.message}</span>}
        </div>
      )}

      <div className="mt-8 grid gap-4 lg:grid-cols-4">
        {/* Free */}
        <PlanColumn name={dict.pricing.free} tagline={dict.pricing.freeTagline}>
          <p className="text-3xl font-bold text-ink">{dict.pricing.free}</p>
          <div className="mt-6">
            <Link href={`/${locale}/signup`} className="btn w-full justify-center">
              {dict.landing.ctaPrimary}
            </Link>
          </div>
        </PlanColumn>

        {/* Pro */}
        <PaidColumn
          name={dict.pricing.pro}
          tagline={dict.pricing.proTagline}
          popular
          price={priceFor('PRO')}
          suffix={suffix}
          money={money}
          dict={dict}
          billingEnabled={billingEnabled}
          busyPriceId={busyPriceId}
          onSubscribe={subscribe}
        />

        {/* Business */}
        <PaidColumn
          name={dict.pricing.business}
          tagline={dict.pricing.businessTagline}
          price={priceFor('BUSINESS')}
          suffix={suffix}
          money={money}
          dict={dict}
          billingEnabled={billingEnabled}
          busyPriceId={busyPriceId}
          onSubscribe={subscribe}
        />

        {/* Enterprise */}
        <PlanColumn name={dict.pricing.enterprise} tagline={dict.pricing.enterpriseTagline}>
          <p className="text-lg font-semibold text-ink-soft">{dict.pricing.contactSales}</p>
          <div className="mt-6">
            <button type="button" className="btn w-full justify-center" disabled>
              {dict.pricing.contactSales}
            </button>
          </div>
        </PlanColumn>
      </div>
    </div>
  );
}

function PlanColumn({
  name,
  tagline,
  popular,
  children,
}: {
  name: string;
  tagline: string;
  popular?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className={`card relative flex flex-col p-6 ${popular ? 'border-accent' : ''}`}>
      <h3 className="text-lg font-semibold text-ink">{name}</h3>
      <p className="mt-1 min-h-[2.5rem] text-sm text-ink-soft">{tagline}</p>
      <div className="mt-4 flex flex-1 flex-col justify-end">{children}</div>
    </div>
  );
}

function PaidColumn({
  name,
  tagline,
  popular,
  price,
  suffix,
  money,
  dict,
  billingEnabled,
  busyPriceId,
  onSubscribe,
}: {
  name: string;
  tagline: string;
  popular?: boolean;
  price: Price | undefined;
  suffix: string;
  money: (amount: number, currency: string) => string;
  dict: Dictionary;
  billingEnabled: boolean;
  busyPriceId: string | null;
  onSubscribe: (priceId: string) => void;
}) {
  const hasTrial = !!price && price.trialDays > 0;
  return (
    <div className={`card relative flex flex-col p-6 ${popular ? 'border-accent' : ''}`}>
      {popular && (
        <span className="absolute -top-3 end-4 rounded-full bg-accent px-2.5 py-0.5 text-xs font-semibold text-on-accent">
          {dict.pricing.mostPopular}
        </span>
      )}
      <h3 className="text-lg font-semibold text-ink">{name}</h3>
      <p className="mt-1 min-h-[2.5rem] text-sm text-ink-soft">{tagline}</p>

      <div className="mt-4">
        {price ? (
          <>
            <p className="text-3xl font-bold text-ink">
              {money(price.amount, price.currency)}
              <span className="text-sm font-medium text-ink-faint"> {suffix}</span>
            </p>
            {hasTrial && (
              <span className="mt-2 inline-block rounded-full bg-accent-soft px-2.5 py-0.5 text-xs font-medium text-accent">
                {price.trialDays} {dict.pricing.trialDays}
              </span>
            )}
          </>
        ) : (
          <p className="text-3xl font-bold text-ink-faint">—</p>
        )}
      </div>

      <div className="mt-6 flex flex-1 flex-col justify-end">
        <button
          type="button"
          className="btn-primary w-full justify-center"
          disabled={!price || !billingEnabled || busyPriceId === price?.id}
          onClick={() => price && onSubscribe(price.id)}
        >
          {busyPriceId === price?.id
            ? dict.common.loading
            : hasTrial
              ? dict.pricing.startTrial
              : dict.pricing.subscribe}
        </button>
      </div>
    </div>
  );
}
