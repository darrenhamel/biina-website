'use client';

import { useEffect, useState } from 'react';
import type { Dictionary } from '@/i18n/dictionaries';
import { Icon } from '@/components/Icon';

export type RagMode = 'off' | 'strict' | 'blended';

interface KnowledgeBaseOption {
  id: string;
  name: string;
}

export function KnowledgeSelector({
  dict,
  selected,
  onSelectedChange,
  mode,
  onModeChange,
}: {
  dict: Dictionary;
  selected: string[];
  onSelectedChange: (ids: string[]) => void;
  mode: RagMode;
  onModeChange: (mode: RagMode) => void;
}) {
  const [bases, setBases] = useState<KnowledgeBaseOption[]>([]);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let active = true;
    fetch('/api/knowledge', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : { knowledgeBases: [] }))
      .then((d) => {
        if (active) setBases(d.knowledgeBases ?? []);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  if (bases.length === 0) return null;

  function toggle(id: string) {
    const next = selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id];
    onSelectedChange(next);
    // Turn RAG on when the first base is picked; off when none remain.
    if (next.length > 0 && mode === 'off') onModeChange('blended');
    if (next.length === 0) onModeChange('off');
  }

  const label =
    selected.length === 0
      ? dict.rag.none
      : `${selected.length} ${dict.rag.selected}`;

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="btn-outline gap-1.5 px-3 py-1.5 text-xs"
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <Icon name="files" width={14} height={14} />
        <span className="truncate">{label}</span>
      </button>
      {open && (
        <>
          <button className="fixed inset-0 z-10" aria-hidden onClick={() => setOpen(false)} />
          <div
            role="menu"
            className="absolute bottom-full start-0 z-20 mb-1 w-64 overflow-hidden rounded-xl border border-line bg-paper-raised py-1 shadow-lg"
          >
            <p className="px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-ink-faint">
              {dict.rag.knowledge}
            </p>
            <ul className="max-h-52 overflow-y-auto scroll-slim">
              {bases.map((b) => {
                const checked = selected.includes(b.id);
                return (
                  <li key={b.id}>
                    <label className="flex cursor-pointer items-center gap-2 px-3 py-2 text-sm text-ink hover:bg-paper-sunken">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggle(b.id)}
                        className="h-4 w-4 accent-[rgb(var(--c-accent))]"
                      />
                      <span className="truncate">{b.name}</span>
                    </label>
                  </li>
                );
              })}
            </ul>
            {selected.length > 0 && (
              <div className="border-t border-line px-3 py-2">
                <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-ink-faint">
                  {dict.rag.mode}
                </p>
                <label className="flex cursor-pointer items-center gap-2 py-1 text-sm text-ink">
                  <input
                    type="radio"
                    name="rag-mode"
                    checked={mode === 'blended'}
                    onChange={() => onModeChange('blended')}
                    className="h-4 w-4 accent-[rgb(var(--c-accent))]"
                  />
                  {dict.rag.modeBlended}
                </label>
                <label className="flex cursor-pointer items-center gap-2 py-1 text-sm text-ink">
                  <input
                    type="radio"
                    name="rag-mode"
                    checked={mode === 'strict'}
                    onChange={() => onModeChange('strict')}
                    className="h-4 w-4 accent-[rgb(var(--c-accent))]"
                  />
                  {dict.rag.modeStrict}
                </label>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
