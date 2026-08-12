'use client';

import { useCallback, useEffect, useState } from 'react';
import type { Locale } from '@/i18n/config';
import type { Dictionary } from '@/i18n/dictionaries';

interface MultimodalData {
  providers: { vision: string; ocr: string; stt: string; tts: string };
  health: { vision: boolean; ocr: boolean; stt: boolean; tts: boolean; storage: boolean };
  usage: { vision: number; ocr: number; sttSeconds: number; ttsCharacters: number; voiceSessions: number };
  errors: number;
  estimatedCost: number;
  mediaAssets: number;
}

export function AdminMultimodalPanel({ locale, dict }: { locale: Locale; dict: Dictionary }) {
  const [data, setData] = useState<MultimodalData | null>(null);
  const [error, setError] = useState<string | null>(null);

  const num = new Intl.NumberFormat(locale === 'ar' ? 'ar-AE' : 'en-US');
  const fmtCost = new Intl.NumberFormat(locale === 'ar' ? 'ar-AE' : 'en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 4,
  });

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch('/api/admin/multimodal', { cache: 'no-store' });
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

  const providerRows: Array<{ label: string; provider: string; healthy: boolean }> = [
    { label: dict.adminMultimodal.vision, provider: data.providers.vision, healthy: data.health.vision },
    { label: dict.adminMultimodal.ocr, provider: data.providers.ocr, healthy: data.health.ocr },
    { label: dict.adminMultimodal.stt, provider: data.providers.stt, healthy: data.health.stt },
    { label: dict.adminMultimodal.tts, provider: data.providers.tts, healthy: data.health.tts },
    { label: dict.adminMultimodal.storage, provider: '—', healthy: data.health.storage },
  ];

  const usageTiles: Array<{ label: string; value: string }> = [
    { label: dict.adminMultimodal.visionImages, value: num.format(data.usage.vision) },
    { label: dict.adminMultimodal.ocrPages, value: num.format(data.usage.ocr) },
    { label: dict.adminMultimodal.sttSeconds, value: num.format(data.usage.sttSeconds) },
    { label: dict.adminMultimodal.ttsCharacters, value: num.format(data.usage.ttsCharacters) },
    { label: dict.adminMultimodal.voiceSessions, value: num.format(data.usage.voiceSessions) },
    { label: dict.adminMultimodal.mediaAssets, value: num.format(data.mediaAssets) },
  ];

  return (
    <div className="scroll-slim h-full overflow-y-auto">
      <div className="mx-auto max-w-4xl px-5 py-8">
        <h1 className="text-2xl font-bold tracking-tight text-ink">{dict.adminMultimodal.title}</h1>
        <p className="mt-1 text-sm text-ink-soft">{dict.adminMultimodal.subtitle}</p>

        {error && <p className="mt-4 rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger">{error}</p>}

        {/* Headline metrics */}
        <div className="mt-6 grid gap-3 sm:grid-cols-3">
          <div className="card p-5">
            <p className="text-3xl font-bold text-ink">{fmtCost.format(data.estimatedCost)}</p>
            <p className="mt-1 text-sm text-ink-soft">
              {dict.adminMultimodal.estimatedCost} ({dict.adminMultimodal.estimate})
            </p>
          </div>
          <div className="card p-5">
            <p className="text-3xl font-bold text-ink">{num.format(data.errors)}</p>
            <p className="mt-1 text-sm text-ink-soft">{dict.adminMultimodal.errors}</p>
          </div>
          <div className="card p-5">
            <p className="text-3xl font-bold text-ink">{num.format(data.mediaAssets)}</p>
            <p className="mt-1 text-sm text-ink-soft">{dict.adminMultimodal.mediaAssets}</p>
          </div>
        </div>

        {/* Providers + health */}
        <h2 className="mt-6 text-sm font-semibold text-ink-soft">{dict.adminMultimodal.providers}</h2>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          {providerRows.map((r) => (
            <div key={r.label} className="card flex items-center justify-between p-4">
              <div className="min-w-0">
                <p className="text-sm font-semibold text-ink">{r.label}</p>
                <p className="mt-0.5 truncate text-xs text-ink-soft">
                  {dict.adminMultimodal.provider}: {r.provider}
                </p>
              </div>
              <span
                className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                  r.healthy ? 'bg-success/15 text-success' : 'bg-danger/10 text-danger'
                }`}
              >
                {r.healthy ? dict.adminMultimodal.healthy : dict.adminMultimodal.unavailable}
              </span>
            </div>
          ))}
        </div>

        {/* Usage (30 days) */}
        <h2 className="mt-6 text-sm font-semibold text-ink-soft">{dict.adminMultimodal.usage}</h2>
        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          {usageTiles.map((t) => (
            <div key={t.label} className="rounded-xl border border-line p-4">
              <p className="text-xl font-bold text-ink">{t.value}</p>
              <p className="mt-0.5 text-xs text-ink-soft">{t.label}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
