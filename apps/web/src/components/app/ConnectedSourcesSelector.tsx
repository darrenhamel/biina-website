'use client';

import { useEffect, useState } from 'react';
import type { Dictionary } from '@/i18n/dictionaries';
import { Icon } from '@/components/Icon';

interface ActiveConnection {
  id: string;
  connectorSlug: string;
  status: string;
  externalAccountEmail: string | null;
  externalAccountName: string | null;
}

export function ConnectedSourcesSelector({
  dict,
  selected,
  onSelectedChange,
}: {
  dict: Dictionary;
  selected: string[];
  onSelectedChange: (ids: string[]) => void;
}) {
  const [connections, setConnections] = useState<ActiveConnection[]>([]);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let active = true;
    fetch('/api/connectors', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : { personalConnections: [], organizationConnections: [] }))
      .then((d) => {
        if (!active) return;
        const all: ActiveConnection[] = [
          ...(d.personalConnections ?? []),
          ...(d.organizationConnections ?? []),
        ];
        setConnections(all.filter((c) => c.status === 'ACTIVE'));
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  if (connections.length === 0) return null;

  function toggle(id: string) {
    onSelectedChange(selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id]);
  }

  const label =
    selected.length === 0 ? dict.connectors.sources : `${selected.length} ${dict.rag.selected}`;

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={`gap-1.5 px-3 py-1.5 text-xs ${selected.length > 0 ? 'btn-primary' : 'btn-outline'}`}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <Icon name="spark" width={14} height={14} />
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
              {dict.connectors.sources}
            </p>
            <ul className="scroll-slim max-h-52 overflow-y-auto">
              {connections.map((c) => {
                const checked = selected.includes(c.id);
                const name = c.externalAccountEmail || c.externalAccountName || c.connectorSlug;
                return (
                  <li key={c.id}>
                    <label className="flex cursor-pointer items-center gap-2 px-3 py-2 text-sm text-ink hover:bg-paper-sunken">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggle(c.id)}
                        className="h-4 w-4 accent-[rgb(var(--c-accent))]"
                      />
                      <span className="min-w-0">
                        <span className="block truncate">{name}</span>
                        <span className="block truncate text-xs text-ink-faint">{c.connectorSlug}</span>
                      </span>
                    </label>
                  </li>
                );
              })}
            </ul>
          </div>
        </>
      )}
    </div>
  );
}
