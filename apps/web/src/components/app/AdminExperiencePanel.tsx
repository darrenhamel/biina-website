'use client';

import type { Locale } from '@/i18n/config';
import type { Dictionary } from '@/i18n/dictionaries';

export interface ExperienceRow {
  id: string;
  label: { en: string; ar: string };
  audienceType: string;
  defaultModelProfile: string;
  allowedCapabilities: string[];
  recommendedCategories: string[];
  navigation: string[];
  enabled: boolean;
  supervisedOnly: boolean;
  defaultForNewUsers: boolean;
}

export function AdminExperiencePanel({
  locale,
  dict,
  profiles,
}: {
  locale: Locale;
  dict: Dictionary;
  profiles: ExperienceRow[];
}) {
  return (
    <div className="scroll-slim h-full overflow-y-auto">
      <div className="mx-auto max-w-4xl px-5 py-8">
        <h1 className="text-2xl font-bold tracking-tight text-ink">{dict.adminExperience.title}</h1>
        <p className="mt-1 text-sm text-ink-soft">{dict.adminExperience.subtitle}</p>

        <p className="mt-4 rounded-lg bg-paper-sunken px-3 py-2 text-xs text-ink-soft">{dict.adminExperience.note}</p>

        <div className="mt-6 space-y-3">
          {profiles.map((p) => (
            <div key={p.id} className="card p-5">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-semibold text-ink" dir="auto">
                    {locale === 'ar' ? p.label.ar : p.label.en}
                  </p>
                  <p className="mt-0.5 text-xs text-ink-faint">
                    {dict.adminExperience.id}: <code dir="ltr">{p.id}</code> · {dict.adminExperience.audience}:{' '}
                    {p.audienceType}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                  {p.defaultForNewUsers && (
                    <span className="rounded-full bg-accent-soft px-2 py-0.5 text-[11px] font-medium text-accent">
                      {dict.adminExperience.defaultBadge}
                    </span>
                  )}
                  <span
                    className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                      p.enabled ? 'bg-success/15 text-success' : 'bg-paper-sunken text-ink-soft'
                    }`}
                  >
                    {dict.adminExperience.selectable}
                  </span>
                  {p.supervisedOnly && (
                    <span className="rounded-full bg-gold/15 px-2 py-0.5 text-[11px] font-medium text-gold">
                      {dict.adminExperience.supervised}
                    </span>
                  )}
                </div>
              </div>

              <dl className="mt-3 grid gap-3 text-xs sm:grid-cols-2">
                <div>
                  <dt className="text-ink-faint">{dict.adminExperience.model}</dt>
                  <dd className="mt-0.5 font-medium text-ink" dir="ltr">
                    {p.defaultModelProfile}
                  </dd>
                </div>
                <div>
                  <dt className="text-ink-faint">{dict.adminExperience.navigation}</dt>
                  <dd className="mt-1 flex flex-wrap gap-1">
                    {p.navigation.map((n) => (
                      <code key={n} className="rounded bg-paper-sunken px-1.5 py-0.5 text-ink-soft" dir="ltr">
                        {n}
                      </code>
                    ))}
                  </dd>
                </div>
                <div>
                  <dt className="text-ink-faint">{dict.adminExperience.capabilities}</dt>
                  <dd className="mt-1 flex flex-wrap gap-1">
                    {p.allowedCapabilities.map((c) => (
                      <code key={c} className="rounded bg-paper-sunken px-1.5 py-0.5 text-ink-soft" dir="ltr">
                        {c}
                      </code>
                    ))}
                  </dd>
                </div>
                <div>
                  <dt className="text-ink-faint">{dict.adminExperience.categories}</dt>
                  <dd className="mt-1 flex flex-wrap gap-1">
                    {p.recommendedCategories.map((c) => (
                      <code key={c} className="rounded bg-paper-sunken px-1.5 py-0.5 text-ink-soft" dir="ltr">
                        {c}
                      </code>
                    ))}
                  </dd>
                </div>
              </dl>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
