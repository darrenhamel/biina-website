'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { Locale } from '@/i18n/config';
import type { Dictionary } from '@/i18n/dictionaries';
import { Icon } from '@/components/Icon';

// ---- Types (mirror the API shapes; UI-only) ----

export type MemoryType =
  | 'PREFERENCE'
  | 'PROFILE_FACT'
  | 'PROJECT_CONTEXT'
  | 'WORKING_RELATIONSHIP'
  | 'ORGANIZATION_CONTEXT'
  | 'RECURRING_INSTRUCTION'
  | 'CUSTOM';

type MemorySource =
  | 'USER_EXPLICIT'
  | 'CONVERSATION_INFERRED'
  | 'ADMIN_DEFINED'
  | 'ORGANIZATION_DEFINED'
  | 'WORKFLOW'
  | 'IMPORT';

type Sensitivity = 'NORMAL' | 'SENSITIVE' | 'RESTRICTED';

export interface MemoryItem {
  id: string;
  content: string;
  type: MemoryType;
  scope: string;
  source: MemorySource;
  sensitivity: Sensitivity;
  confidence: number;
  ownerType: 'PERSONAL' | 'ORGANIZATION';
  createdAt: string;
  updatedAt: string;
}

const MEMORY_TYPES: MemoryType[] = [
  'PREFERENCE',
  'PROFILE_FACT',
  'PROJECT_CONTEXT',
  'WORKING_RELATIONSHIP',
  'ORGANIZATION_CONTEXT',
  'RECURRING_INSTRUCTION',
  'CUSTOM',
];

export function typeLabel(type: MemoryType, dict: Dictionary): string {
  const map: Record<MemoryType, string> = {
    PREFERENCE: dict.personalization.typePreference,
    PROFILE_FACT: dict.personalization.typeProfileFact,
    PROJECT_CONTEXT: dict.personalization.typeProjectContext,
    WORKING_RELATIONSHIP: dict.personalization.typeWorkingRelationship,
    ORGANIZATION_CONTEXT: dict.personalization.typeOrganizationContext,
    RECURRING_INSTRUCTION: dict.personalization.typeRecurringInstruction,
    CUSTOM: dict.personalization.typeCustom,
  };
  return map[type] ?? type;
}

function sourceLabel(source: MemorySource, dict: Dictionary): string {
  const map: Record<MemorySource, string> = {
    USER_EXPLICIT: dict.personalization.sourceExplicit,
    CONVERSATION_INFERRED: dict.personalization.sourceInferred,
    ADMIN_DEFINED: dict.personalization.sourceAdmin,
    ORGANIZATION_DEFINED: dict.personalization.sourceOrg,
    WORKFLOW: dict.personalization.sourceWorkflow,
    IMPORT: dict.personalization.sourceImport,
  };
  return map[source] ?? source;
}

export function sensitivityBadge(sensitivity: Sensitivity, dict: Dictionary): string | null {
  if (sensitivity === 'SENSITIVE') return dict.personalization.sensitiveBadge;
  if (sensitivity === 'RESTRICTED') return dict.personalization.restrictedBadge;
  return null;
}

function TypeBadge({ type, dict }: { type: MemoryType; dict: Dictionary }) {
  return (
    <span className="rounded-full bg-accent-soft px-2.5 py-0.5 text-[11px] font-semibold text-accent">
      {typeLabel(type, dict)}
    </span>
  );
}

function SourceBadge({ source, dict }: { source: MemorySource; dict: Dictionary }) {
  const explicit = source === 'USER_EXPLICIT';
  return (
    <span
      className={`rounded-full px-2.5 py-0.5 text-[11px] font-medium ${
        explicit ? 'bg-success/15 text-success' : 'bg-paper-sunken text-ink-soft'
      }`}
    >
      {sourceLabel(source, dict)}
    </span>
  );
}

/**
 * Reusable memory list/create/edit/delete surface. Scope (personal vs org) is
 * derived server-side from the active workspace for the list; the add form sends
 * `ownerType`. When `canManage` is false the surface is read-only.
 */
export function MemoryManager({
  locale,
  dict,
  ownerType,
  canManage = true,
  enabled = true,
}: {
  locale: Locale;
  dict: Dictionary;
  ownerType: 'PERSONAL' | 'ORGANIZATION';
  canManage?: boolean;
  enabled?: boolean;
}) {
  const [items, setItems] = useState<MemoryItem[] | null>(null);
  const [search, setSearch] = useState('');
  const [error, setError] = useState<string | null>(null);
  const isOrg = ownerType === 'ORGANIZATION';

  const fmtDate = new Intl.DateTimeFormat(locale === 'ar' ? 'ar-AE' : 'en-US', { dateStyle: 'medium' });

  const load = useCallback(
    async (q?: string) => {
      setError(null);
      try {
        const url = q && q.trim() ? `/api/memory?search=${encodeURIComponent(q.trim())}` : '/api/memory';
        const res = await fetch(url, { cache: 'no-store' });
        if (!res.ok) throw new Error();
        const body = await res.json();
        setItems(Array.isArray(body.memories) ? body.memories : []);
      } catch {
        setError(dict.common.somethingWrong);
        setItems([]);
      }
    },
    [dict],
  );

  useEffect(() => {
    void load();
  }, [load]);

  // Debounced search.
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  function onSearchChange(v: string) {
    setSearch(v);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => void load(v), 300);
  }

  return (
    <div className="space-y-4">
      {/* Add form */}
      {canManage && <AddMemoryForm dict={dict} ownerType={ownerType} onAdded={() => load(search)} />}

      {/* List */}
      <section className="card p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-ink">
            {isOrg ? dict.personalization.orgTitle : dict.personalization.listTitle}
          </h2>
        </div>

        <div className="mt-3 flex items-center gap-2 rounded-xl border border-line bg-paper px-3 py-1.5 focus-within:border-accent">
          <Icon name="search" width={16} height={16} />
          <input
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder={dict.personalization.searchPlaceholder}
            className="w-full bg-transparent text-sm text-ink outline-none placeholder:text-ink-faint"
          />
        </div>

        {error && (
          <p role="alert" className="mt-3 rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger">
            {error}
          </p>
        )}

        {items === null ? (
          <div className="grid place-items-center py-8">
            <span className="h-6 w-6 animate-spin rounded-full border-2 border-line-strong border-t-accent" />
          </div>
        ) : items.length === 0 ? (
          <p className="mt-4 rounded-xl border border-dashed border-line px-4 py-8 text-center text-sm text-ink-faint">
            {isOrg ? dict.personalization.emptyOrg : dict.personalization.empty}
          </p>
        ) : (
          <ul className="mt-4 space-y-2">
            {items.map((m) => (
              <MemoryRow
                key={m.id}
                dict={dict}
                item={m}
                canManage={canManage}
                fmtDate={fmtDate}
                onChanged={() => load(search)}
              />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function MemoryRow({
  dict,
  item,
  canManage,
  fmtDate,
  onChanged,
}: {
  dict: Dictionary;
  item: MemoryItem;
  canManage: boolean;
  fmtDate: Intl.DateTimeFormat;
  onChanged: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(item.content);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sens = sensitivityBadge(item.sensitivity, dict);

  async function saveEdit() {
    const content = draft.trim();
    if (content.length < 3) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/memory/${item.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok || !body || body.ok !== true) {
        setError((body && body.error) || dict.common.somethingWrong);
        return;
      }
      setEditing(false);
      onChanged();
    } catch {
      setError(dict.common.somethingWrong);
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!window.confirm(dict.personalization.deleteConfirm)) return;
    setBusy(true);
    try {
      await fetch(`/api/memory/${item.id}`, { method: 'DELETE' });
      onChanged();
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className="rounded-xl border border-line px-3 py-2.5">
      <div className="flex flex-wrap items-center gap-1.5">
        <TypeBadge type={item.type} dict={dict} />
        <SourceBadge source={item.source} dict={dict} />
        {sens && (
          <span className="rounded-full bg-gold/15 px-2.5 py-0.5 text-[11px] font-semibold text-gold">{sens}</span>
        )}
        <span className="ms-auto text-[11px] text-ink-faint">{fmtDate.format(new Date(item.createdAt))}</span>
      </div>

      {editing ? (
        <>
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            dir="auto"
            rows={2}
            maxLength={2000}
            className="mt-2 w-full resize-y rounded-xl border border-line bg-paper px-3 py-2 text-sm text-ink outline-none focus:border-accent"
          />
          {error && <p className="mt-1.5 text-xs text-danger">{error}</p>}
          <div className="mt-2 flex items-center gap-2">
            <button onClick={saveEdit} disabled={busy} className="btn-primary px-3 py-1.5 text-xs">
              {dict.personalization.saveEdit}
            </button>
            <button
              onClick={() => {
                setEditing(false);
                setDraft(item.content);
                setError(null);
              }}
              disabled={busy}
              className="btn-ghost px-3 py-1.5 text-xs"
            >
              {dict.common.cancel}
            </button>
          </div>
        </>
      ) : (
        <>
          <p dir="auto" className="mt-2 whitespace-pre-wrap text-start text-sm text-ink">
            {item.content}
          </p>
          {canManage && (
            <div className="mt-2 flex items-center gap-1.5">
              <button onClick={() => setEditing(true)} className="btn-ghost px-2.5 py-1 text-xs">
                {dict.personalization.edit}
              </button>
              <button onClick={remove} disabled={busy} className="btn-ghost px-2.5 py-1 text-xs text-danger">
                {dict.personalization.remove}
              </button>
            </div>
          )}
        </>
      )}
    </li>
  );
}

function AddMemoryForm({
  dict,
  ownerType,
  onAdded,
}: {
  dict: Dictionary;
  ownerType: 'PERSONAL' | 'ORGANIZATION';
  onAdded: () => void;
}) {
  const [content, setContent] = useState('');
  const [type, setType] = useState<MemoryType>('PREFERENCE');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [needsSensitive, setNeedsSensitive] = useState(false);

  async function submit(confirmSensitive: boolean) {
    const trimmed = content.trim();
    if (trimmed.length < 3) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/memory', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content: trimmed,
          memoryType: type,
          ownerType,
          ...(confirmSensitive ? { confirmSensitive: true } : {}),
        }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok || !body || body.ok !== true) {
        // Sensitive content needs explicit confirmation — offer that path.
        if (res.status === 400 && body && body.data && body.data.sensitivity) {
          setNeedsSensitive(true);
          setError(body.error || dict.personalization.sensitiveConfirmPrompt);
          return;
        }
        setError((body && body.error) || dict.common.somethingWrong);
        return;
      }
      setContent('');
      setType('PREFERENCE');
      setNeedsSensitive(false);
      onAdded();
    } catch {
      setError(dict.common.somethingWrong);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card p-5">
      <h2 className="text-sm font-semibold text-ink">{dict.personalization.addTitle}</h2>
      <p className="mt-0.5 text-xs text-ink-faint">{dict.personalization.addHint}</p>

      <textarea
        value={content}
        onChange={(e) => {
          setContent(e.target.value);
          setNeedsSensitive(false);
          setError(null);
        }}
        dir="auto"
        placeholder={dict.personalization.addPlaceholder}
        rows={2}
        maxLength={2000}
        className="mt-3 w-full resize-y rounded-xl border border-line bg-paper px-3 py-2 text-sm text-ink outline-none focus:border-accent"
      />

      <div className="mt-3 flex flex-wrap items-end gap-3">
        <label className="block">
          <span className="text-xs font-medium text-ink-soft">{dict.personalization.addType}</span>
          <select
            value={type}
            onChange={(e) => setType(e.target.value as MemoryType)}
            className="mt-1 block rounded-xl border border-line bg-paper px-3 py-2 text-sm text-ink outline-none focus:border-accent"
          >
            {MEMORY_TYPES.map((t) => (
              <option key={t} value={t}>
                {typeLabel(t, dict)}
              </option>
            ))}
          </select>
        </label>
        <button
          onClick={() => submit(false)}
          disabled={busy || content.trim().length < 3}
          className="btn-primary px-4 py-2 text-sm"
        >
          {busy ? dict.personalization.adding : dict.personalization.add}
        </button>
      </div>

      {error && (
        <div className="mt-3 rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger">
          <p>{error}</p>
          {needsSensitive && (
            <button
              onClick={() => submit(true)}
              disabled={busy}
              className="btn-primary mt-2 px-3 py-1.5 text-xs"
            >
              {dict.personalization.confirmSensitiveButton}
            </button>
          )}
        </div>
      )}
    </section>
  );
}
