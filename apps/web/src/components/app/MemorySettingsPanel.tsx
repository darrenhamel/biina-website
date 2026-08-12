'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import type { Locale } from '@/i18n/config';
import type { Dictionary } from '@/i18n/dictionaries';
import { Icon } from '@/components/Icon';
import { MemoryManager, sensitivityBadge, typeLabel, type MemoryType } from '@/components/app/MemoryManager';

type MemoryMode = 'OFF' | 'ASK' | 'AUTO';
type ResponseStyle = 'default' | 'concise' | 'detailed';
type Tone = 'default' | 'formal' | 'casual';

interface Settings {
  memoryEnabled: boolean;
  memoryMode: MemoryMode;
  responseStyle: ResponseStyle;
  tone: Tone;
}

interface Candidate {
  id: string;
  content: string;
  type: MemoryType;
  sensitivity: 'NORMAL' | 'SENSITIVE' | 'RESTRICTED';
  reason: string | null;
  createdAt: string;
}

export function MemorySettingsPanel({
  locale,
  dict,
  hasOrganizations,
}: {
  locale: Locale;
  dict: Dictionary;
  hasOrganizations: boolean;
}) {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [clearedNote, setClearedNote] = useState<string | null>(null);
  const [listKey, setListKey] = useState(0);

  const loadSettings = useCallback(async () => {
    try {
      const res = await fetch('/api/memory/settings', { cache: 'no-store' });
      if (res.status === 403) {
        setError(dict.personalization.unavailable);
        return;
      }
      if (!res.ok) throw new Error();
      const body = await res.json();
      setSettings(body.settings);
    } catch {
      setError(dict.common.somethingWrong);
    }
  }, [dict]);

  const loadCandidates = useCallback(async () => {
    try {
      const res = await fetch('/api/memory/candidates', { cache: 'no-store' });
      if (!res.ok) return;
      const body = await res.json();
      setCandidates(Array.isArray(body.candidates) ? body.candidates : []);
    } catch {
      /* non-fatal */
    }
  }, []);

  useEffect(() => {
    void loadSettings();
    void loadCandidates();
  }, [loadSettings, loadCandidates]);

  async function patch(update: Partial<Settings>) {
    // Optimistic update.
    setSettings((prev) => (prev ? { ...prev, ...update } : prev));
    setSaved(false);
    try {
      const res = await fetch('/api/memory/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(update),
      });
      if (!res.ok) throw new Error();
      const body = await res.json();
      setSettings(body.settings);
      setSaved(true);
      setTimeout(() => setSaved(false), 1500);
    } catch {
      setError(dict.common.somethingWrong);
      void loadSettings();
    }
  }

  async function clearAll() {
    if (!window.confirm(dict.personalization.clearConfirm)) return;
    setClearing(true);
    setClearedNote(null);
    try {
      const res = await fetch('/api/memory/clear', { method: 'POST' });
      if (!res.ok) throw new Error();
      setClearedNote(dict.personalization.cleared);
      // Force the memory list to reload by remounting via key bump below.
      setListKey((k) => k + 1);
    } catch {
      setError(dict.common.somethingWrong);
    } finally {
      setClearing(false);
    }
  }

  if (!settings && error) {
    return (
      <div className="scroll-slim h-full overflow-y-auto">
        <div className="mx-auto max-w-2xl px-5 py-8">
          <h1 className="text-2xl font-bold tracking-tight text-ink">{dict.personalization.title}</h1>
          <p className="mt-4 rounded-lg bg-paper-sunken px-3 py-2 text-sm text-ink-soft">{error}</p>
        </div>
      </div>
    );
  }

  if (!settings) {
    return (
      <div className="grid h-full place-items-center">
        <span className="h-6 w-6 animate-spin rounded-full border-2 border-line-strong border-t-accent" />
      </div>
    );
  }

  return (
    <div className="scroll-slim h-full overflow-y-auto">
      <div className="mx-auto max-w-2xl px-5 py-8">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-ink">{dict.personalization.title}</h1>
            <p className="mt-1 text-sm text-ink-soft">{dict.personalization.subtitle}</p>
          </div>
          {saved && (
            <span className="rounded-full bg-success/15 px-2.5 py-0.5 text-xs font-semibold text-success">
              {dict.personalization.saved}
            </span>
          )}
        </div>

        {error && (
          <p role="alert" className="mt-4 rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger">
            {error}
          </p>
        )}

        {/* Consent controls */}
        <section className="card mt-6 space-y-5 p-5">
          <h2 className="text-sm font-semibold text-ink">{dict.personalization.consentTitle}</h2>

          {/* On/off */}
          <label className="flex items-start justify-between gap-3">
            <span>
              <span className="block text-sm font-medium text-ink">{dict.personalization.memoryEnabled}</span>
              <span className="mt-0.5 block text-xs text-ink-faint">{dict.personalization.memoryEnabledHint}</span>
            </span>
            <Toggle
              on={settings.memoryEnabled}
              onLabel={dict.personalization.on}
              offLabel={dict.personalization.off}
              onChange={(v) => patch({ memoryEnabled: v })}
            />
          </label>

          {/* Save mode */}
          <div>
            <p className="text-sm font-medium text-ink">{dict.personalization.saveModeTitle}</p>
            <p className="mt-0.5 text-xs text-ink-faint">{dict.personalization.saveModeHint}</p>
            <div className="mt-2 grid gap-2 sm:grid-cols-3">
              <Choice
                active={settings.memoryMode === 'OFF'}
                title={dict.personalization.modeOff}
                hint={dict.personalization.modeOffHint}
                onClick={() => patch({ memoryMode: 'OFF' })}
              />
              <Choice
                active={settings.memoryMode === 'ASK'}
                title={dict.personalization.modeAsk}
                hint={dict.personalization.modeAskHint}
                onClick={() => patch({ memoryMode: 'ASK' })}
              />
              <Choice
                active={settings.memoryMode === 'AUTO'}
                title={dict.personalization.modeAuto}
                hint={dict.personalization.modeAutoHint}
                onClick={() => patch({ memoryMode: 'AUTO' })}
              />
            </div>
          </div>

          {/* Response style */}
          <div>
            <p className="text-sm font-medium text-ink">{dict.personalization.styleTitle}</p>
            <p className="mt-0.5 text-xs text-ink-faint">{dict.personalization.styleHint}</p>
            <div className="mt-2 grid gap-2 sm:grid-cols-3">
              <Choice active={settings.responseStyle === 'default'} title={dict.personalization.styleDefault} onClick={() => patch({ responseStyle: 'default' })} />
              <Choice active={settings.responseStyle === 'concise'} title={dict.personalization.styleConcise} onClick={() => patch({ responseStyle: 'concise' })} />
              <Choice active={settings.responseStyle === 'detailed'} title={dict.personalization.styleDetailed} onClick={() => patch({ responseStyle: 'detailed' })} />
            </div>
          </div>

          {/* Tone */}
          <div>
            <p className="text-sm font-medium text-ink">{dict.personalization.toneTitle}</p>
            <p className="mt-0.5 text-xs text-ink-faint">{dict.personalization.toneHint}</p>
            <div className="mt-2 grid gap-2 sm:grid-cols-3">
              <Choice active={settings.tone === 'default'} title={dict.personalization.toneDefault} onClick={() => patch({ tone: 'default' })} />
              <Choice active={settings.tone === 'formal'} title={dict.personalization.toneFormal} onClick={() => patch({ tone: 'formal' })} />
              <Choice active={settings.tone === 'casual'} title={dict.personalization.toneCasual} onClick={() => patch({ tone: 'casual' })} />
            </div>
          </div>
        </section>

        {/* Pending suggestions — only when present */}
        {candidates.length > 0 && (
          <section className="card mt-4 p-5">
            <h2 className="text-sm font-semibold text-ink">{dict.personalization.suggestionsTitle}</h2>
            <p className="mt-0.5 text-xs text-ink-faint">{dict.personalization.suggestionsHint}</p>
            <ul className="mt-3 space-y-2">
              {candidates.map((c) => (
                <CandidateRow
                  key={c.id}
                  dict={dict}
                  candidate={c}
                  onDecided={() => {
                    void loadCandidates();
                    setListKey((k) => k + 1);
                  }}
                />
              ))}
            </ul>
          </section>
        )}

        {/* Memory list + add form (personal) */}
        <div className="mt-4">
          <MemoryManager key={listKey} locale={locale} dict={dict} ownerType="PERSONAL" canManage enabled />
        </div>

        {/* Organization memory link */}
        {hasOrganizations && (
          <Link
            href={`/${locale}/app/settings/organization-memory`}
            className="card mt-4 flex items-center justify-between p-4 transition-colors hover:border-accent"
          >
            <span className="flex items-center gap-3">
              <span className="grid h-9 w-9 place-items-center rounded-xl bg-accent-soft text-accent">
                <Icon name="user" width={18} height={18} />
              </span>
              <span className="text-sm font-medium text-ink">{dict.personalization.manageOrg}</span>
            </span>
            <Icon name="send" width={16} height={16} />
          </Link>
        )}

        {/* Clear all */}
        <section className="card mt-4 border-danger/30 p-5">
          <h2 className="text-sm font-semibold text-ink">{dict.personalization.clearTitle}</h2>
          <p className="mt-1 text-xs text-ink-soft">{dict.personalization.clearHint}</p>
          {clearedNote && (
            <p className="mt-3 rounded-lg bg-success/15 px-3 py-2 text-sm text-success">{clearedNote}</p>
          )}
          <button
            onClick={clearAll}
            disabled={clearing}
            className="btn-ghost mt-3 px-3 py-2 text-sm text-danger"
          >
            {dict.personalization.clearButton}
          </button>
        </section>
      </div>
    </div>
  );
}

function CandidateRow({
  dict,
  candidate,
  onDecided,
}: {
  dict: Dictionary;
  candidate: Candidate;
  onDecided: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sens = sensitivityBadge(candidate.sensitivity, dict);
  const isSensitive = candidate.sensitivity !== 'NORMAL';

  async function decide(decision: 'ACCEPTED' | 'REJECTED', confirmSensitive = false) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/memory/candidates/${candidate.id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ decision, ...(confirmSensitive ? { confirmSensitive: true } : {}) }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok || !body || body.ok !== true) {
        setError((body && body.error) || dict.common.somethingWrong);
        return;
      }
      onDecided();
    } catch {
      setError(dict.common.somethingWrong);
    } finally {
      setBusy(false);
    }
  }

  function onAccept() {
    if (isSensitive && !confirming) {
      setConfirming(true);
      return;
    }
    void decide('ACCEPTED', isSensitive);
  }

  return (
    <li className="rounded-xl border border-line px-3 py-2.5">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="rounded-full bg-accent-soft px-2.5 py-0.5 text-[11px] font-semibold text-accent">
          {typeLabel(candidate.type, dict)}
        </span>
        {sens && (
          <span className="rounded-full bg-gold/15 px-2.5 py-0.5 text-[11px] font-semibold text-gold">{sens}</span>
        )}
      </div>
      <p dir="auto" className="mt-2 whitespace-pre-wrap text-start text-sm text-ink">
        {candidate.content}
      </p>
      {candidate.reason && (
        <p className="mt-1 text-xs text-ink-faint">
          {dict.personalization.suggestionReason}: {candidate.reason}
        </p>
      )}
      {confirming && (
        <p className="mt-2 text-xs text-gold">{dict.personalization.sensitiveConfirmPrompt}</p>
      )}
      {error && <p className="mt-1.5 text-xs text-danger">{error}</p>}
      <div className="mt-2 flex items-center gap-1.5">
        <button onClick={onAccept} disabled={busy} className="btn-primary px-3 py-1.5 text-xs">
          {confirming ? dict.personalization.confirmSensitiveButton : dict.personalization.accept}
        </button>
        <button onClick={() => decide('REJECTED')} disabled={busy} className="btn-ghost px-3 py-1.5 text-xs text-danger">
          {dict.personalization.reject}
        </button>
      </div>
    </li>
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

function Choice({
  active,
  title,
  hint,
  onClick,
}: {
  active: boolean;
  title: string;
  hint?: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`rounded-xl border px-3 py-2.5 text-start transition-colors ${
        active ? 'border-accent bg-accent-soft' : 'border-line hover:border-line-strong'
      }`}
    >
      <span className={`block text-sm font-semibold ${active ? 'text-accent' : 'text-ink'}`}>{title}</span>
      {hint && <span className="mt-0.5 block text-xs text-ink-soft">{hint}</span>}
    </button>
  );
}
