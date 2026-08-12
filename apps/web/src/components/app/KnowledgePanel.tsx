'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import Link from 'next/link';
import type { Locale } from '@/i18n/config';
import type { Dictionary } from '@/i18n/dictionaries';
import { Icon } from '@/components/Icon';

interface KnowledgeBaseRow {
  id: string;
  name: string;
  description: string | null;
  status: string;
  organizationId: string | null;
  createdAt: string;
  documentCount: number;
}

type Workspace = 'personal' | 'organization';

export function KnowledgePanel({ locale, dict }: { locale: Locale; dict: Dictionary }) {
  const [bases, setBases] = useState<KnowledgeBaseRow[]>([]);
  const [workspace, setWorkspace] = useState<Workspace>('personal');
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch('/api/knowledge', { cache: 'no-store' });
      if (!res.ok) throw new Error();
      const data = await res.json();
      setBases(data.knowledgeBases ?? []);
      setWorkspace((data.workspace as Workspace) ?? 'personal');
    } catch {
      setError(dict.common.somethingWrong);
    } finally {
      setLoaded(true);
    }
  }, [dict]);

  useEffect(() => {
    void load();
  }, [load]);

  async function onCreate(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!name.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/knowledge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), description: description.trim() || undefined }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error || dict.common.somethingWrong);
        return;
      }
      setName('');
      setDescription('');
      await load();
    } catch {
      setError(dict.common.somethingWrong);
    } finally {
      setBusy(false);
    }
  }

  const badgeLabel =
    workspace === 'organization' ? dict.knowledge.orgKnowledge : dict.knowledge.personalKnowledge;

  return (
    <div className="scroll-slim h-full overflow-y-auto">
      <div className="mx-auto max-w-3xl px-5 py-8">
        <h1 className="text-2xl font-bold tracking-tight text-ink">{dict.knowledge.title}</h1>
        <p className="mt-1 text-sm text-ink-soft">{dict.knowledge.subtitle}</p>

        {error && (
          <p role="alert" className="mt-4 rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger">
            {error}
          </p>
        )}

        {/* Create */}
        <form onSubmit={onCreate} className="card mt-6 p-5">
          <h2 className="text-sm font-semibold text-ink">{dict.knowledge.createBase}</h2>
          <div className="mt-3 space-y-3">
            <div>
              <label htmlFor="kb-name" className="mb-1.5 block text-sm font-medium text-ink">
                {dict.knowledge.baseName}
              </label>
              <input
                id="kb-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="field"
                required
              />
            </div>
            <div>
              <label htmlFor="kb-desc" className="mb-1.5 block text-sm font-medium text-ink">
                {dict.knowledge.baseDescription}
              </label>
              <input
                id="kb-desc"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                className="field"
              />
            </div>
            <button type="submit" className="btn-primary" disabled={busy || !name.trim()}>
              {busy ? dict.common.loading : dict.knowledge.createBase}
            </button>
          </div>
        </form>

        {/* List */}
        <h2 className="mt-6 text-sm font-semibold text-ink-soft">{dict.knowledge.bases}</h2>
        {loaded && bases.length === 0 ? (
          <p className="mt-3 rounded-xl border border-dashed border-line px-4 py-8 text-center text-sm text-ink-soft">
            {dict.knowledge.noBases}
          </p>
        ) : (
          <ul className="mt-3 grid gap-3">
            {bases.map((b) => (
              <li key={b.id}>
                <Link
                  href={`/${locale}/app/knowledge/${b.id}`}
                  className="card flex items-center justify-between p-4 transition-colors hover:border-accent"
                >
                  <span className="flex min-w-0 items-center gap-3">
                    <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-accent-soft text-accent">
                      <Icon name="files" />
                    </span>
                    <span className="min-w-0">
                      <span className="flex items-center gap-2">
                        <span className="truncate font-semibold text-ink">{b.name}</span>
                        <span className="shrink-0 rounded-full bg-paper-sunken px-2 py-0.5 text-[11px] font-medium text-ink-soft">
                          {badgeLabel}
                        </span>
                      </span>
                      <span className="block text-sm text-ink-soft">
                        {b.documentCount} {dict.knowledge.documents}
                      </span>
                    </span>
                  </span>
                  <Icon name="send" width={18} height={18} />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
