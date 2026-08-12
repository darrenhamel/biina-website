'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import type { Locale } from '@/i18n/config';
import type { Dictionary } from '@/i18n/dictionaries';
import { Icon } from '@/components/Icon';

/**
 * Persona-aware home surface. Renders the active experience profile's `home`
 * starter actions. Selecting an experience only changes these defaults and
 * recommendations — never security or permissions.
 */

interface HomeAction {
  labelKey: string;
  target: string;
  kind: 'route' | 'library' | 'template';
}

interface ActiveProfile {
  id: string;
  slug: string;
  label: { en: string; ar: string };
  home: HomeAction[];
}

function homeLabel(dict: Dictionary, key: string): string {
  const home = dict.experience.home as Record<string, string>;
  return home[key] ?? key;
}

function actionHref(locale: Locale, action: HomeAction): string {
  const base = `/${locale}/app`;
  if (action.kind === 'library') return `${base}/discover`;
  if (action.kind === 'template') return `${base}/chat`;
  return `${base}/${action.target}`;
}

export function PersonaHome({ locale, dict }: { locale: Locale; dict: Dictionary }) {
  const [active, setActive] = useState<ActiveProfile | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch('/api/experience', { cache: 'no-store' });
        if (!res.ok) return;
        const body = await res.json();
        if (alive) setActive(body.active ?? null);
      } catch {
        /* non-fatal */
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  if (!active || active.home.length === 0) return null;

  return (
    <section>
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold text-ink">{dict.experience.homeHeading}</h2>
          <p className="mt-0.5 text-xs text-ink-soft">{dict.experience.homeSubtitle}</p>
        </div>
        <Link
          href={`/${locale}/app/onboarding`}
          className="text-xs font-medium text-accent hover:underline"
        >
          {dict.experience.change}
        </Link>
      </div>
      <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {active.home.map((action, i) => (
          <Link
            key={`${action.labelKey}-${i}`}
            href={actionHref(locale, action)}
            className="card flex items-center gap-3 p-4 transition-colors hover:border-accent"
          >
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-accent-soft text-accent">
              <Icon name="spark" width={18} height={18} />
            </span>
            <span className="text-sm font-medium text-ink" dir="auto">
              {homeLabel(dict, action.labelKey)}
            </span>
          </Link>
        ))}
      </div>
    </section>
  );
}
