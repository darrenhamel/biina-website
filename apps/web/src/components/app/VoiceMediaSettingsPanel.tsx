'use client';

import { useEffect, useState } from 'react';
import type { Locale } from '@/i18n/config';
import type { Dictionary } from '@/i18n/dictionaries';
import {
  DEFAULT_VOICE_MEDIA_SETTINGS,
  loadVoiceMediaSettings,
  saveVoiceMediaSettings,
  type VoiceMediaSettings,
} from '@/lib/voice-media';

interface Voice {
  slug: string;
  displayName: string;
  language: string;
  locale: string;
}

const SPEEDS = [0.75, 1, 1.25, 1.5, 2];

export function VoiceMediaSettingsPanel({ locale, dict }: { locale: Locale; dict: Dictionary }) {
  const [settings, setSettings] = useState<VoiceMediaSettings>(DEFAULT_VOICE_MEDIA_SETTINGS);
  const [voices, setVoices] = useState<Voice[]>([]);
  const [saved, setSaved] = useState(false);

  // Load persisted preferences on mount (client-only).
  useEffect(() => {
    setSettings(loadVoiceMediaSettings());
  }, []);

  // Load available voices (vendor-neutral names).
  useEffect(() => {
    let active = true;
    fetch('/api/voices')
      .then((r) => (r.ok ? r.json() : { voices: [] }))
      .then((d) => {
        if (active) setVoices(Array.isArray(d.voices) ? d.voices : []);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  function update(patch: Partial<VoiceMediaSettings>) {
    setSettings((prev) => {
      const next = { ...prev, ...patch };
      saveVoiceMediaSettings(next);
      return next;
    });
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  }

  const numFmt = new Intl.NumberFormat(locale === 'ar' ? 'ar-AE' : 'en-US');

  return (
    <div className="scroll-slim h-full overflow-y-auto">
      <div className="mx-auto max-w-2xl px-5 py-8">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-ink">{dict.voiceMedia.title}</h1>
            <p className="mt-1 text-sm text-ink-soft">{dict.voiceMedia.subtitle}</p>
          </div>
          {saved && (
            <span className="rounded-full bg-success/15 px-2.5 py-0.5 text-xs font-semibold text-success">
              {dict.voiceMedia.saved}
            </span>
          )}
        </div>

        <section className="card mt-6 space-y-5 p-5">
          {/* Voice responses on/off */}
          <label className="flex items-start justify-between gap-3">
            <span>
              <span className="block text-sm font-medium text-ink">{dict.voiceMedia.responsesTitle}</span>
              <span className="mt-0.5 block text-xs text-ink-faint">{dict.voiceMedia.responsesHint}</span>
            </span>
            <Toggle
              on={settings.voiceResponsesEnabled}
              onLabel={dict.voiceMedia.on}
              offLabel={dict.voiceMedia.off}
              onChange={(v) => update({ voiceResponsesEnabled: v })}
            />
          </label>

          {/* Preferred voice */}
          <div>
            <p className="text-sm font-medium text-ink">{dict.voiceMedia.voiceTitle}</p>
            <p className="mt-0.5 text-xs text-ink-faint">{dict.voiceMedia.voiceHint}</p>
            <select
              value={settings.preferredVoice}
              onChange={(e) => update({ preferredVoice: e.target.value })}
              className="mt-2 w-full rounded-xl border border-line bg-paper px-3 py-2 text-sm text-ink outline-none focus:border-accent"
              aria-label={dict.voiceMedia.voiceTitle}
            >
              <option value="">{dict.voiceMedia.voiceAuto}</option>
              {voices.map((v) => (
                <option key={v.slug} value={v.slug}>
                  {v.displayName}
                </option>
              ))}
            </select>
            {voices.length === 0 && (
              <p className="mt-1.5 text-xs text-ink-faint">{dict.voiceMedia.noVoices}</p>
            )}
          </div>

          {/* Playback speed */}
          <div>
            <p className="text-sm font-medium text-ink">{dict.voiceMedia.speedTitle}</p>
            <p className="mt-0.5 text-xs text-ink-faint">{dict.voiceMedia.speedHint}</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {SPEEDS.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => update({ playbackSpeed: s })}
                  aria-pressed={settings.playbackSpeed === s}
                  className={`rounded-xl border px-3 py-1.5 text-sm transition-colors ${
                    settings.playbackSpeed === s
                      ? 'border-accent bg-accent-soft text-accent'
                      : 'border-line text-ink-soft hover:border-line-strong'
                  }`}
                >
                  {numFmt.format(s)}×
                </button>
              ))}
            </div>
          </div>

          {/* Auto-play in voice mode */}
          <label className="flex items-start justify-between gap-3">
            <span>
              <span className="block text-sm font-medium text-ink">{dict.voiceMedia.autoplayTitle}</span>
              <span className="mt-0.5 block text-xs text-ink-faint">{dict.voiceMedia.autoplayHint}</span>
            </span>
            <Toggle
              on={settings.autoPlayInVoiceMode}
              onLabel={dict.voiceMedia.on}
              offLabel={dict.voiceMedia.off}
              onChange={(v) => update({ autoPlayInVoiceMode: v })}
            />
          </label>
        </section>

        <p className="mt-3 text-xs text-ink-faint">{dict.voiceMedia.localNote}</p>
      </div>
    </div>
  );
}

function Toggle({
  on,
  onLabel,
  offLabel,
  onChange,
}: {
  on: boolean;
  onLabel: string;
  offLabel: string;
  onChange: (v: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      onClick={() => onChange(!on)}
      className={`inline-flex shrink-0 items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors ${
        on ? 'border-accent bg-accent-soft text-accent' : 'border-line text-ink-soft'
      }`}
    >
      <span className={`h-2 w-2 rounded-full ${on ? 'bg-accent' : 'bg-ink-faint'}`} />
      {on ? onLabel : offLabel}
    </button>
  );
}
