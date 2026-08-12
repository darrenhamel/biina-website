'use client';

import { useCallback, useEffect, useState } from 'react';
import type { Locale } from '@/i18n/config';
import type { Dictionary } from '@/i18n/dictionaries';
import { Icon } from '@/components/Icon';

// ---- Types (mirror the API shapes; UI-only) ----

interface Overview {
  killSwitches: { library: boolean; publicLibrary: boolean; creatorPublishing: boolean; paidMarketplace: boolean };
  items: { total: number; published: number; draft: number; inReview: number; suspended: number };
  byType: Record<string, number>;
  pendingReviews: number;
  installations: number;
  recent: Array<{
    id: string;
    title: string;
    itemType: string;
    status: string;
    visibility: string;
    risk: string;
    installs: number;
    createdAt: string;
  }>;
}

interface ReviewEntry {
  reviewId: string;
  itemId: string;
  title: string;
  itemType: string;
  publisherType: string;
  riskLevel: string;
  validation: unknown;
  version: { id: string; version: number; requiredTools: string[]; requiredConnectors: string[]; changeNotes: string | null } | null;
  createdAt: string;
}

// ---- Label helpers ----

function itemTypeLabel(type: string, dict: Dictionary): string {
  const map: Record<string, string> = {
    PROMPT_TEMPLATE: dict.library.typePrompt,
    AGENT_TEMPLATE: dict.library.typeAgent,
    WORKFLOW_TEMPLATE: dict.library.typeWorkflow,
    RESEARCH_TEMPLATE: dict.library.typeResearch,
    KNOWLEDGE_TEMPLATE: dict.library.typeKnowledge,
  };
  return map[type] ?? dict.library.typeOther;
}

function riskLabel(risk: string, dict: Dictionary): string {
  const map: Record<string, string> = {
    CONTENT_ONLY: dict.library.riskContentOnly,
    READ_ONLY: dict.library.riskReadOnly,
    WRITE_CAPABLE: dict.library.riskWriteCapable,
    SCHEDULED_WRITE: dict.library.riskScheduledWrite,
    HIGH_RISK: dict.library.riskHigh,
  };
  return map[risk] ?? dict.library.riskOther;
}

function riskClass(risk: string): string {
  switch (risk) {
    case 'CONTENT_ONLY':
      return 'bg-success/15 text-success';
    case 'READ_ONLY':
      return 'bg-accent-soft text-accent';
    case 'WRITE_CAPABLE':
      return 'bg-gold/15 text-gold';
    case 'SCHEDULED_WRITE':
    case 'HIGH_RISK':
      return 'bg-danger/10 text-danger';
    default:
      return 'bg-paper-sunken text-ink-soft';
  }
}

function publisherLabel(type: string, dict: Dictionary): string {
  if (type === 'BIINA') return dict.adminLibrary.publisherBiina;
  if (type === 'ORGANIZATION') return dict.adminLibrary.publisherOrg;
  if (type === 'USER') return dict.adminLibrary.publisherUser;
  return type;
}

function validationFlags(validation: unknown): string[] {
  if (!validation || typeof validation !== 'object') return [];
  const v = validation as Record<string, unknown>;
  const flags: string[] = [];
  for (const key of ['errors', 'issues', 'warnings']) {
    const arr = v[key];
    if (Array.isArray(arr)) {
      for (const item of arr) {
        if (typeof item === 'string') flags.push(item);
        else if (item && typeof item === 'object' && typeof (item as { message?: string }).message === 'string')
          flags.push((item as { message: string }).message);
        else flags.push(key);
      }
    }
  }
  return flags;
}

function SwitchBadge({ on, dict }: { on: boolean; dict: Dictionary }) {
  return (
    <span
      className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${
        on ? 'bg-success/15 text-success' : 'bg-paper-sunken text-ink-soft'
      }`}
    >
      {on ? dict.adminLibrary.enabled : dict.adminLibrary.disabled}
    </span>
  );
}

export function AdminLibraryPanel({ locale, dict }: { locale: Locale; dict: Dictionary }) {
  const [overview, setOverview] = useState<Overview | null>(null);
  const [queue, setQueue] = useState<ReviewEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const num = new Intl.NumberFormat(locale === 'ar' ? 'ar-AE' : 'en-US');
  const fmtDateTime = new Intl.DateTimeFormat(locale === 'ar' ? 'ar-AE' : 'en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
  });

  const load = useCallback(async () => {
    setError(null);
    try {
      const [ovRes, qRes] = await Promise.all([
        fetch('/api/admin/library', { cache: 'no-store' }),
        fetch('/api/admin/library/reviews', { cache: 'no-store' }),
      ]);
      if (!ovRes.ok) throw new Error();
      setOverview(await ovRes.json());
      if (qRes.ok) {
        const body = await qRes.json();
        setQueue(Array.isArray(body.queue) ? body.queue : []);
      } else {
        setQueue([]);
      }
    } catch {
      setError(dict.common.somethingWrong);
    }
  }, [dict]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!overview) {
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

  const metricTiles = [
    { label: dict.adminLibrary.total, value: overview.items.total },
    { label: dict.adminLibrary.published, value: overview.items.published },
    { label: dict.adminLibrary.draft, value: overview.items.draft },
    { label: dict.adminLibrary.inReview, value: overview.items.inReview },
    { label: dict.adminLibrary.suspended, value: overview.items.suspended },
    { label: dict.adminLibrary.installations, value: overview.installations },
  ];

  const byTypeEntries = Object.entries(overview.byType);

  return (
    <div className="scroll-slim h-full overflow-y-auto">
      <div className="mx-auto max-w-4xl px-5 py-8">
        <h1 className="text-2xl font-bold tracking-tight text-ink">{dict.adminLibrary.title}</h1>
        <p className="mt-1 text-sm text-ink-soft">{dict.adminLibrary.subtitle}</p>

        {error && <p className="mt-4 rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger">{error}</p>}

        {/* Kill switches */}
        <h2 className="mt-6 text-sm font-semibold text-ink-soft">{dict.adminLibrary.controls}</h2>
        <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <SwitchTile label={dict.adminLibrary.killLibrary} on={overview.killSwitches.library} dict={dict} />
          <SwitchTile label={dict.adminLibrary.killPublic} on={overview.killSwitches.publicLibrary} dict={dict} />
          <SwitchTile label={dict.adminLibrary.killCreator} on={overview.killSwitches.creatorPublishing} dict={dict} />
          <SwitchTile label={dict.adminLibrary.killPaid} on={overview.killSwitches.paidMarketplace} dict={dict} />
        </div>

        {/* Metrics */}
        <h2 className="mt-6 text-sm font-semibold text-ink-soft">{dict.adminLibrary.metrics}</h2>
        <div className="mt-3 grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {metricTiles.map((t) => (
            <div key={t.label} className="rounded-xl border border-line p-4">
              <p className="text-xl font-bold text-ink">{num.format(t.value)}</p>
              <p className="mt-0.5 text-xs text-ink-soft">{t.label}</p>
            </div>
          ))}
        </div>

        {byTypeEntries.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {byTypeEntries.map(([type, n]) => (
              <span key={type} className="rounded-full bg-paper-sunken px-2.5 py-0.5 text-xs text-ink-soft">
                {itemTypeLabel(type, dict)}: {num.format(n)}
              </span>
            ))}
          </div>
        )}

        {/* Review queue */}
        <h2 className="mt-8 flex items-center gap-2 text-sm font-semibold text-ink-soft">
          <Icon name="shield" width={16} height={16} />
          {dict.adminLibrary.reviewQueue}
          {overview.pendingReviews > 0 && (
            <span className="rounded-full bg-gold/15 px-2 py-0.5 text-[11px] font-semibold text-gold">
              {num.format(overview.pendingReviews)}
            </span>
          )}
        </h2>
        {queue === null ? (
          <div className="mt-3 grid place-items-center py-8">
            <span className="h-5 w-5 animate-spin rounded-full border-2 border-line-strong border-t-accent" />
          </div>
        ) : queue.length === 0 ? (
          <p className="mt-3 text-sm text-ink-faint">{dict.adminLibrary.queueEmpty}</p>
        ) : (
          <div className="mt-3 space-y-3">
            {queue.map((entry) => (
              <ReviewCard key={entry.reviewId} entry={entry} locale={locale} dict={dict} onDone={load} />
            ))}
          </div>
        )}

        {/* Recent items */}
        <h2 className="mt-8 text-sm font-semibold text-ink-soft">{dict.adminLibrary.recent}</h2>
        {overview.recent.length === 0 ? (
          <p className="mt-3 text-sm text-ink-faint">{dict.adminLibrary.noData}</p>
        ) : (
          <div className="mt-3 space-y-3">
            {overview.recent.map((r) => (
              <RecentCard key={r.id} r={r} locale={locale} dict={dict} fmt={fmtDateTime} onDone={load} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function SwitchTile({ label, on, dict }: { label: string; on: boolean; dict: Dictionary }) {
  return (
    <div className="card flex items-center justify-between p-4">
      <span className="text-sm font-medium text-ink">{label}</span>
      <SwitchBadge on={on} dict={dict} />
    </div>
  );
}

function ReviewCard({
  entry,
  locale,
  dict,
  onDone,
}: {
  entry: ReviewEntry;
  locale: Locale;
  dict: Dictionary;
  onDone: () => void;
}) {
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fmtDate = new Intl.DateTimeFormat(locale === 'ar' ? 'ar-AE' : 'en-US', { dateStyle: 'medium' });
  const flags = validationFlags(entry.validation);

  async function act(action: 'APPROVE' | 'REJECT' | 'REQUEST_CHANGES' | 'SUSPEND') {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/library/reviews/${entry.reviewId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, ...(notes.trim() ? { notes: notes.trim() } : {}) }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        setError((body && body.error) || dict.common.somethingWrong);
        return;
      }
      setDone(true);
      onDone();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <span className="min-w-0 font-semibold text-ink" dir="auto">
          {entry.title}
        </span>
        <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${riskClass(entry.riskLevel)}`}>
          {riskLabel(entry.riskLevel, dict)}
        </span>
      </div>

      <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-ink-faint">
        <span>
          {dict.adminLibrary.type}: <span className="text-ink-soft">{itemTypeLabel(entry.itemType, dict)}</span>
        </span>
        <span>
          {dict.adminLibrary.publisher}: <span className="text-ink-soft">{publisherLabel(entry.publisherType, dict)}</span>
        </span>
        {entry.version && (
          <span>
            {dict.adminLibrary.version}: <span className="text-ink-soft">{entry.version.version}</span>
          </span>
        )}
        <span>{fmtDate.format(new Date(entry.createdAt))}</span>
      </div>

      {/* Required tools / connectors */}
      {entry.version && (entry.version.requiredTools.length > 0 || entry.version.requiredConnectors.length > 0) && (
        <div className="mt-2 grid gap-2 text-[11px] sm:grid-cols-2">
          {entry.version.requiredTools.length > 0 && (
            <div>
              <p className="text-ink-faint">{dict.adminLibrary.requiredTools}</p>
              <div className="mt-1 flex flex-wrap gap-1">
                {entry.version.requiredTools.map((t) => (
                  <code key={t} className="rounded bg-paper-sunken px-1.5 py-0.5 text-ink-soft" dir="ltr">
                    {t}
                  </code>
                ))}
              </div>
            </div>
          )}
          {entry.version.requiredConnectors.length > 0 && (
            <div>
              <p className="text-ink-faint">{dict.adminLibrary.requiredConnectors}</p>
              <div className="mt-1 flex flex-wrap gap-1">
                {entry.version.requiredConnectors.map((c) => (
                  <code key={c} className="rounded bg-paper-sunken px-1.5 py-0.5 text-ink-soft" dir="ltr">
                    {c}
                  </code>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Validation */}
      <div className="mt-2">
        <span className="text-[11px] text-ink-faint">{dict.adminLibrary.validation}: </span>
        {flags.length === 0 ? (
          <span className="rounded-full bg-success/15 px-2 py-0.5 text-[11px] font-medium text-success">
            {dict.adminLibrary.validationOk}
          </span>
        ) : (
          <span className="rounded-full bg-danger/10 px-2 py-0.5 text-[11px] font-medium text-danger">
            {dict.adminLibrary.validationFlags}: {flags.length}
          </span>
        )}
        {flags.length > 0 && (
          <ul className="mt-1 space-y-0.5">
            {flags.map((f, i) => (
              <li key={i} className="text-[11px] text-ink-soft" dir="auto">
                • {f}
              </li>
            ))}
          </ul>
        )}
      </div>

      {entry.version?.changeNotes && (
        <p className="mt-2 whitespace-pre-wrap text-xs text-ink-soft" dir="auto">
          {entry.version.changeNotes}
        </p>
      )}

      {error && <p className="mt-2 rounded-lg bg-danger/10 px-3 py-2 text-xs text-danger">{error}</p>}
      {done ? (
        <p className="mt-3 rounded-lg bg-success/15 px-3 py-2 text-xs text-success">{dict.adminLibrary.actionDone}</p>
      ) : (
        <>
          <input
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder={dict.adminLibrary.notesPlaceholder}
            dir="auto"
            className="mt-3 w-full rounded-xl border border-line bg-paper px-3 py-2 text-sm text-ink outline-none focus:border-accent"
          />
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <button onClick={() => act('APPROVE')} disabled={busy} className="btn-primary px-3 py-1.5 text-xs">
              {dict.adminLibrary.approve}
            </button>
            <button onClick={() => act('REQUEST_CHANGES')} disabled={busy} className="btn-ghost px-3 py-1.5 text-xs">
              {dict.adminLibrary.requestChanges}
            </button>
            <button onClick={() => act('REJECT')} disabled={busy} className="btn-ghost px-3 py-1.5 text-xs text-danger">
              {dict.adminLibrary.reject}
            </button>
            <button onClick={() => act('SUSPEND')} disabled={busy} className="btn-ghost px-3 py-1.5 text-xs text-danger">
              {dict.adminLibrary.suspend}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function RecentCard({
  r,
  locale,
  dict,
  fmt,
  onDone,
}: {
  r: Overview['recent'][number];
  locale: Locale;
  dict: Dictionary;
  fmt: Intl.DateTimeFormat;
  onDone: () => void;
}) {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const num = new Intl.NumberFormat(locale === 'ar' ? 'ar-AE' : 'en-US');

  const canManage = r.status === 'PUBLISHED';

  async function act(action: 'suspend' | 'deprecate') {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/library/${r.id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, ...(reason.trim() ? { reason: reason.trim() } : {}) }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        setError((body && body.error) || dict.common.somethingWrong);
        return;
      }
      setDone(true);
      setOpen(false);
      onDone();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <span className="min-w-0 font-medium text-ink" dir="auto">
          {r.title}
        </span>
        <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${riskClass(r.risk)}`}>
          {riskLabel(r.risk, dict)}
        </span>
      </div>
      <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-ink-faint">
        <span>{itemTypeLabel(r.itemType, dict)}</span>
        <span className="uppercase tracking-wide">{r.status}</span>
        <span>{num.format(r.installs)} {dict.library.installs}</span>
        <span>{fmt.format(new Date(r.createdAt))}</span>
      </div>

      {error && <p className="mt-2 rounded-lg bg-danger/10 px-3 py-2 text-xs text-danger">{error}</p>}
      {done && <p className="mt-2 rounded-lg bg-success/15 px-3 py-2 text-xs text-success">{dict.adminLibrary.actionDone}</p>}

      {canManage && !done && (
        <div className="mt-3">
          {!open ? (
            <button onClick={() => setOpen(true)} className="btn-ghost px-2.5 py-1 text-xs">
              {dict.adminLibrary.manageItem}
            </button>
          ) : (
            <>
              <input
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder={dict.adminLibrary.reasonPlaceholder}
                dir="auto"
                className="w-full rounded-xl border border-line bg-paper px-3 py-2 text-sm text-ink outline-none focus:border-accent"
              />
              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                <button onClick={() => act('suspend')} disabled={busy} className="btn-ghost px-3 py-1.5 text-xs text-danger">
                  {dict.adminLibrary.suspend}
                </button>
                <button onClick={() => act('deprecate')} disabled={busy} className="btn-ghost px-3 py-1.5 text-xs">
                  {dict.adminLibrary.deprecate}
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
