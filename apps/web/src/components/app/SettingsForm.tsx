'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { locales, localeLabel, type Locale } from '@/i18n/config';
import type { Dictionary } from '@/i18n/dictionaries';
import { personas, type PersonaId } from '@/config/personas';

export function SettingsForm({
  locale,
  dict,
  initial,
}: {
  locale: Locale;
  dict: Dictionary;
  initial: { displayName: string; locale: Locale; personaId: PersonaId };
}) {
  const router = useRouter();
  const [displayName, setDisplayName] = useState(initial.displayName);
  const [uiLocale, setUiLocale] = useState<Locale>(initial.locale);
  const [personaId, setPersonaId] = useState<PersonaId>(initial.personaId);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  async function save() {
    setSaving(true);
    setSaved(false);
    try {
      await fetch('/api/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ displayName, locale: uiLocale, personaId }),
      });
      document.cookie = `biina_locale=${uiLocale}; path=/; max-age=31536000; samesite=lax`;
      setSaved(true);
      if (uiLocale !== locale) {
        router.push(`/${uiLocale}/app/settings`);
      }
      router.refresh();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      {/* Profile */}
      <section className="card p-5">
        <h2 className="text-sm font-semibold text-ink">{dict.settings.profile}</h2>
        <div className="mt-3 max-w-sm">
          <label htmlFor="displayName" className="mb-1.5 block text-sm text-ink-soft">
            {dict.common.displayName}
          </label>
          <input
            id="displayName"
            className="field"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
          />
        </div>
      </section>

      {/* Language */}
      <section className="card p-5">
        <h2 className="text-sm font-semibold text-ink">{dict.settings.language}</h2>
        <p className="mt-0.5 text-sm text-ink-soft">{dict.settings.languageHelp}</p>
        <div className="mt-3 flex gap-2">
          {locales.map((l) => (
            <button
              key={l}
              type="button"
              onClick={() => setUiLocale(l)}
              className={`rounded-xl border px-4 py-2 text-sm font-medium ${
                uiLocale === l
                  ? 'border-accent bg-accent-soft text-accent'
                  : 'border-line-strong text-ink-soft hover:bg-paper-sunken'
              }`}
            >
              {localeLabel[l]}
            </button>
          ))}
        </div>
      </section>

      {/* Persona / experience */}
      <section className="card p-5">
        <h2 className="text-sm font-semibold text-ink">{dict.settings.persona}</h2>
        <p className="mt-0.5 text-sm text-ink-soft">{dict.settings.personaHelp}</p>
        <div className="mt-3 grid gap-2 sm:grid-cols-3">
          {Object.values(personas).map((p) => {
            const active = personaId === p.id;
            return (
              <button
                key={p.id}
                type="button"
                disabled={!p.enabled}
                onClick={() => p.enabled && setPersonaId(p.id)}
                className={`rounded-xl border px-3 py-2.5 text-start text-sm ${
                  active ? 'border-accent bg-accent-soft text-accent' : 'border-line-strong text-ink-soft'
                } ${p.enabled ? 'hover:bg-paper-sunken' : 'cursor-not-allowed opacity-60'}`}
              >
                <span className="block font-medium">{p.label[locale]}</span>
                {!p.enabled && <span className="text-xs text-ink-faint">{dict.common.comingSoon}</span>}
              </button>
            );
          })}
        </div>
      </section>

      <div className="flex items-center gap-3">
        <button onClick={save} className="btn-primary" disabled={saving}>
          {saving ? dict.common.loading : dict.common.save}
        </button>
        {saved && <span className="text-sm font-medium text-success" role="status">✓</span>}
      </div>
    </div>
  );
}
