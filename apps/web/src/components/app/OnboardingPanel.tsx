'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import type { Locale } from '@/i18n/config';
import type { Dictionary } from '@/i18n/dictionaries';
import { Icon } from '@/components/Icon';

interface Profile {
  id: string;
  slug: string;
  label: { en: string; ar: string };
  audienceType: string;
  recommendedCapabilities: string[];
  recommendedCategories: string[];
}

interface ExperienceData {
  active: Profile;
  choices: Profile[];
}

export function OnboardingPanel({ locale, dict }: { locale: Locale; dict: Dictionary }) {
  const [data, setData] = useState<ExperienceData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [savedId, setSavedId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/experience', { cache: 'no-store' });
      if (!res.ok) throw new Error();
      setData(await res.json());
    } catch {
      setError(dict.experience.loadError);
    }
  }, [dict]);

  useEffect(() => {
    void load();
  }, [load]);

  async function select(personaId: string) {
    setSaving(true);
    setError(null);
    setSavedId(null);
    try {
      const res = await fetch('/api/experience', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ personaId }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok || !body || !body.active) {
        setError((body && body.error) || dict.common.somethingWrong);
        return;
      }
      setSavedId(personaId);
      setData((prev) => (prev ? { ...prev, active: body.active } : prev));
    } finally {
      setSaving(false);
    }
  }

  const label = (p: Profile) => (locale === 'ar' ? p.label.ar : p.label.en);

  return (
    <div className="scroll-slim h-full overflow-y-auto">
      <div className="mx-auto max-w-3xl px-5 py-8">
        <h1 className="text-2xl font-bold tracking-tight text-ink">{dict.experience.onboardingTitle}</h1>
        <p className="mt-1 text-sm text-ink-soft">{dict.experience.onboardingSubtitle}</p>

        {error && (
          <p role="alert" className="mt-4 rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger">
            {error}
          </p>
        )}

        {!data ? (
          <div className="mt-8 grid place-items-center">
            <span className="h-6 w-6 animate-spin rounded-full border-2 border-line-strong border-t-accent" />
          </div>
        ) : (
          <>
            <h2 className="mt-8 text-sm font-semibold text-ink-soft">{dict.experience.question}</h2>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              {data.choices.map((p) => {
                const isActive = data.active.id === p.id;
                return (
                  <div
                    key={p.id}
                    className={`card flex flex-col p-5 ${isActive ? 'border-accent bg-accent-soft/30' : ''}`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <span className="font-semibold text-ink" dir="auto">
                        {label(p)}
                      </span>
                      {isActive && (
                        <span className="flex items-center gap-1 rounded-full bg-accent px-2 py-0.5 text-[11px] font-medium text-on-accent">
                          <Icon name="check" width={11} height={11} />
                          {dict.experience.selected}
                        </span>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={() => select(p.id)}
                      disabled={saving || isActive}
                      className={`mt-4 ${isActive ? 'btn-ghost' : 'btn-primary'} px-3 py-1.5 text-sm`}
                    >
                      {saving && savedId === p.id
                        ? dict.experience.saving
                        : isActive
                          ? dict.experience.selected
                          : dict.experience.select}
                    </button>
                  </div>
                );
              })}
            </div>

            <p className="mt-4 rounded-lg bg-paper-sunken px-3 py-2 text-xs text-ink-soft">
              {dict.experience.changeNote}
            </p>

            {savedId && (
              <p className="mt-3 rounded-lg bg-success/15 px-3 py-2 text-sm text-success">{dict.experience.saved}</p>
            )}

            <div className="mt-6 flex flex-wrap items-center gap-2">
              <Link href={`/${locale}/app/discover`} className="btn-primary gap-1.5 px-4 py-2 text-sm">
                <Icon name="discover" width={16} height={16} />
                {dict.experience.goToLibrary}
              </Link>
              <Link href={`/${locale}/app/chat`} className="btn-ghost px-3 py-2 text-sm">
                {dict.experience.continue}
              </Link>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
