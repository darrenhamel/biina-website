'use client';

import { useEffect, useState } from 'react';
import type { Locale } from '@/i18n/config';
import type { Dictionary } from '@/i18n/dictionaries';

interface Window {
  requests: number;
  tokens: number;
  requestLimit: number | null;
  tokenLimit: number | null;
  remainingRequests: number | null;
  remainingTokens: number | null;
}
interface UsageData {
  plan: { slug: string; displayName: string };
  month: Window;
  day: Window;
  resetsAt: string;
}

export function UsagePanel({ locale, dict }: { locale: Locale; dict: Dictionary }) {
  const [data, setData] = useState<UsageData | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    fetch('/api/ai/usage')
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then(setData)
      .catch(() => setError(true));
  }, []);

  const nf = new Intl.NumberFormat(locale === 'ar' ? 'ar-AE' : 'en-US');

  return (
    <div className="scroll-slim h-full overflow-y-auto">
      <div className="mx-auto max-w-2xl px-5 py-8">
        <h1 className="text-2xl font-bold tracking-tight text-ink">{dict.usage.title}</h1>

        {error && <p className="mt-4 text-sm text-danger">{dict.common.somethingWrong}</p>}
        {!data && !error && (
          <div className="mt-8 grid place-items-center">
            <span className="h-6 w-6 animate-spin rounded-full border-2 border-line-strong border-t-accent" />
          </div>
        )}

        {data && (
          <div className="mt-6 space-y-4">
            <div className="card flex items-center justify-between p-5">
              <span className="text-sm text-ink-soft">{dict.usage.yourPlan}</span>
              <span className="rounded-full bg-accent-soft px-3 py-1 text-sm font-semibold text-accent">
                {data.plan.displayName}
              </span>
            </div>

            <UsageCard
              title={dict.usage.thisMonth}
              requests={data.month.requests}
              requestLimit={data.month.requestLimit}
              tokens={data.month.tokens}
              tokenLimit={data.month.tokenLimit}
              dict={dict}
              nf={nf}
            />
            <UsageCard
              title={dict.usage.today}
              requests={data.day.requests}
              requestLimit={data.day.requestLimit}
              tokens={data.day.tokens}
              tokenLimit={data.day.tokenLimit}
              dict={dict}
              nf={nf}
            />

            <p className="text-center text-xs text-ink-faint">
              {dict.usage.resets}:{' '}
              {new Intl.DateTimeFormat(locale === 'ar' ? 'ar-AE' : 'en-US', { dateStyle: 'long' }).format(new Date(data.resetsAt))}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

function UsageCard({
  title,
  requests,
  requestLimit,
  tokens,
  tokenLimit,
  dict,
  nf,
}: {
  title: string;
  requests: number;
  requestLimit: number | null;
  tokens: number;
  tokenLimit: number | null;
  dict: Dictionary;
  nf: Intl.NumberFormat;
}) {
  return (
    <div className="card p-5">
      <h2 className="text-sm font-semibold text-ink">{title}</h2>
      <div className="mt-3 space-y-3">
        <Meter label={dict.usage.requests} used={requests} limit={requestLimit} dict={dict} nf={nf} />
        <Meter label={dict.usage.tokens} used={tokens} limit={tokenLimit} dict={dict} nf={nf} />
      </div>
    </div>
  );
}

function Meter({
  label,
  used,
  limit,
  dict,
  nf,
}: {
  label: string;
  used: number;
  limit: number | null;
  dict: Dictionary;
  nf: Intl.NumberFormat;
}) {
  const pct = limit && limit > 0 ? Math.min(100, Math.round((used / limit) * 100)) : 0;
  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-sm">
        <span className="text-ink-soft">{label}</span>
        <span className="text-ink">
          {nf.format(used)}
          {limit != null ? (
            <span className="text-ink-faint"> {dict.usage.ofLimit} {nf.format(limit)}</span>
          ) : (
            <span className="text-ink-faint"> · {dict.usage.unlimited}</span>
          )}
        </span>
      </div>
      {limit != null && (
        <div className="h-2 overflow-hidden rounded-full bg-paper-sunken">
          <div
            className={`h-full rounded-full ${pct >= 100 ? 'bg-danger' : pct >= 80 ? 'bg-gold' : 'bg-accent'}`}
            style={{ width: `${pct}%` }}
          />
        </div>
      )}
    </div>
  );
}
