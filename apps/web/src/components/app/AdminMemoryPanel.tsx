'use client';

import { useCallback, useEffect, useState } from 'react';
import type { Locale } from '@/i18n/config';
import type { Dictionary } from '@/i18n/dictionaries';
import { typeLabel, type MemoryType } from '@/components/app/MemoryManager';

interface AdminMemoryData {
  totalActive: number;
  byType: Array<{ type: string; count: number }>;
  pendingCandidates: number;
  expired: number;
  personal: number;
  organization: number;
  embedding: { ok: boolean; model: string; detail?: string };
}

function labelForType(type: string, dict: Dictionary): string {
  const known: MemoryType[] = [
    'PREFERENCE',
    'PROFILE_FACT',
    'PROJECT_CONTEXT',
    'WORKING_RELATIONSHIP',
    'ORGANIZATION_CONTEXT',
    'RECURRING_INSTRUCTION',
    'CUSTOM',
  ];
  return known.includes(type as MemoryType) ? typeLabel(type as MemoryType, dict) : type;
}

export function AdminMemoryPanel({ locale, dict }: { locale: Locale; dict: Dictionary }) {
  const [data, setData] = useState<AdminMemoryData | null>(null);
  const [error, setError] = useState<string | null>(null);

  const num = new Intl.NumberFormat(locale === 'ar' ? 'ar-AE' : 'en-US');

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch('/api/admin/memory', { cache: 'no-store' });
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
    { label: dict.adminMemory.totalActive, value: num.format(data.totalActive) },
    { label: dict.adminMemory.personal, value: num.format(data.personal) },
    { label: dict.adminMemory.organization, value: num.format(data.organization) },
    { label: dict.adminMemory.pendingCandidates, value: num.format(data.pendingCandidates) },
    { label: dict.adminMemory.expired, value: num.format(data.expired) },
  ];

  return (
    <div className="scroll-slim h-full overflow-y-auto">
      <div className="mx-auto max-w-4xl px-5 py-8">
        <h1 className="text-2xl font-bold tracking-tight text-ink">{dict.adminMemory.title}</h1>
        <p className="mt-1 text-sm text-ink-soft">{dict.adminMemory.subtitle}</p>

        {error && <p className="mt-4 rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger">{error}</p>}

        {/* Counts */}
        <div className="mt-6 grid gap-3 sm:grid-cols-3">
          {tiles.map((t) => (
            <div key={t.label} className="card p-5">
              <p className="text-3xl font-bold text-ink">{t.value}</p>
              <p className="mt-1 text-sm text-ink-soft">{t.label}</p>
            </div>
          ))}
        </div>

        {/* Embedding health */}
        <section className="card mt-6 p-5">
          <h2 className="text-sm font-semibold text-ink">{dict.adminMemory.embedding}</h2>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <span
              className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                data.embedding.ok ? 'bg-success/15 text-success' : 'bg-danger/10 text-danger'
              }`}
            >
              {data.embedding.ok ? dict.adminMemory.embeddingOk : dict.adminMemory.embeddingDown}
            </span>
            <span className="text-sm text-ink-soft">
              {dict.adminMemory.embeddingModel}:{' '}
              <code className="rounded bg-paper-sunken px-1.5 py-0.5 text-[13px] text-ink">
                {data.embedding.model}
              </code>
            </span>
            {data.embedding.detail && (
              <span className="text-xs text-ink-faint">{data.embedding.detail}</span>
            )}
          </div>
        </section>

        {/* By type */}
        <section className="card mt-4 p-5">
          <h2 className="mb-3 text-sm font-semibold text-ink">{dict.adminMemory.byType}</h2>
          {data.byType.length === 0 ? (
            <p className="text-sm text-ink-faint">{dict.adminMemory.noData}</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-start text-sm">
                <thead>
                  <tr className="text-xs uppercase tracking-wide text-ink-faint">
                    <th className="px-2 py-1 text-start font-medium">{dict.adminMemory.type}</th>
                    <th className="px-2 py-1 text-start font-medium">{dict.adminMemory.count}</th>
                  </tr>
                </thead>
                <tbody className="text-ink-soft">
                  {data.byType.map((r) => (
                    <tr key={r.type} className="border-t border-line">
                      <td className="px-2 py-2 font-medium text-ink">{labelForType(r.type, dict)}</td>
                      <td className="px-2 py-2">{num.format(r.count)}</td>
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
