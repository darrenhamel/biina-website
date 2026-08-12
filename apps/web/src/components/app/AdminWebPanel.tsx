'use client';

import { useCallback, useEffect, useState } from 'react';
import type { Locale } from '@/i18n/config';
import type { Dictionary } from '@/i18n/dictionaries';

interface WebConfig {
  maxResults?: number;
  maxPages?: number;
  defaultLanguage?: string;
  safeMode?: boolean | string;
}
interface PeriodStats {
  searches: number;
  pagesFetched: number;
  fetchFailures: number;
  errors: number;
  avgSearchMs?: number;
  avgFetchMs?: number;
}
interface WebData {
  enabled: boolean;
  provider: string;
  providerHealth: { ok: boolean; detail?: string };
  config: WebConfig;
  today: PeriodStats;
  month: PeriodStats;
}

function formatMs(ms: number | undefined, locale: Locale): string {
  if (ms == null || Number.isNaN(ms)) return '—';
  const fmt = new Intl.NumberFormat(locale === 'ar' ? 'ar-AE' : 'en-US', {
    maximumFractionDigits: 0,
  });
  return `${fmt.format(Math.round(ms))} ms`;
}

export function AdminWebPanel({ locale, dict }: { locale: Locale; dict: Dictionary }) {
  const [data, setData] = useState<WebData | null>(null);
  const [error, setError] = useState<string | null>(null);

  const num = new Intl.NumberFormat(locale === 'ar' ? 'ar-AE' : 'en-US');

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch('/api/admin/web', { cache: 'no-store' });
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

  const tiles: Array<{ label: string; value: string }> = [
    { label: dict.adminWeb.searchesToday, value: num.format(data.today.searches) },
    { label: dict.adminWeb.searchesMonth, value: num.format(data.month.searches) },
    { label: dict.adminWeb.pagesFetched, value: num.format(data.today.pagesFetched) },
    { label: dict.adminWeb.failures, value: num.format(data.today.fetchFailures) },
    { label: dict.adminWeb.errors, value: num.format(data.today.errors) },
    { label: dict.adminWeb.avgSearchLatency, value: formatMs(data.today.avgSearchMs, locale) },
    { label: dict.adminWeb.avgFetchLatency, value: formatMs(data.today.avgFetchMs, locale) },
  ];

  const safeMode =
    typeof data.config.safeMode === 'boolean'
      ? data.config.safeMode
        ? dict.adminWeb.enabled
        : dict.adminWeb.disabled
      : data.config.safeMode ?? '—';

  const configRows: Array<{ label: string; value: string }> = [
    { label: dict.adminWeb.maxResults, value: data.config.maxResults != null ? num.format(data.config.maxResults) : '—' },
    { label: dict.adminWeb.maxPages, value: data.config.maxPages != null ? num.format(data.config.maxPages) : '—' },
    { label: dict.adminWeb.safeMode, value: String(safeMode) },
  ];

  return (
    <div className="scroll-slim h-full overflow-y-auto">
      <div className="mx-auto max-w-4xl px-5 py-8">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-bold tracking-tight text-ink">{dict.adminWeb.title}</h1>
          <span
            className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${
              data.enabled ? 'bg-success/15 text-success' : 'bg-danger/10 text-danger'
            }`}
          >
            {data.enabled ? dict.adminWeb.enabled : dict.adminWeb.disabled}
          </span>
        </div>
        <p className="mt-1 text-sm text-ink-soft">{dict.adminWeb.subtitle}</p>

        {error && (
          <p className="mt-4 rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger">{error}</p>
        )}

        {/* Provider + health */}
        <section className="card mt-6 p-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <p className="text-xs text-ink-soft">{dict.adminWeb.provider}</p>
              <p className="mt-0.5 text-base font-bold text-ink">{data.provider}</p>
            </div>
            <div>
              <p className="text-xs text-ink-soft">{dict.adminWeb.health}</p>
              <p className="mt-0.5 flex items-center gap-2 text-base font-bold text-ink">
                <span
                  className={`h-2.5 w-2.5 shrink-0 rounded-full ${
                    data.providerHealth.ok ? 'bg-success' : 'bg-danger'
                  }`}
                />
                {data.providerHealth.ok ? dict.adminWeb.healthy : dict.adminWeb.unhealthy}
              </p>
              {data.providerHealth.detail && (
                <p className="mt-0.5 text-xs text-ink-faint">{data.providerHealth.detail}</p>
              )}
            </div>
          </div>
        </section>

        {/* Stat tiles */}
        <div className="mt-4 grid gap-3 sm:grid-cols-4">
          {tiles.map((t) => (
            <div key={t.label} className="rounded-xl border border-line p-4">
              <p className="truncate text-xl font-bold text-ink">{t.value}</p>
              <p className="mt-0.5 text-xs text-ink-soft">{t.label}</p>
            </div>
          ))}
        </div>

        {/* Config readout */}
        <section className="card mt-4 p-5">
          <h2 className="mb-3 text-sm font-semibold text-ink">{dict.adminWeb.config}</h2>
          <div className="grid gap-3 sm:grid-cols-3">
            {configRows.map((r) => (
              <div key={r.label} className="rounded-xl border border-line p-4">
                <p className="truncate text-base font-bold text-ink">{r.value}</p>
                <p className="mt-0.5 text-xs text-ink-soft">{r.label}</p>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
