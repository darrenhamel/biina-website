'use client';

import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import type { Locale } from '@/i18n/config';
import type { Dictionary } from '@/i18n/dictionaries';
import { Icon } from '@/components/Icon';

interface DocumentRow {
  id: string;
  displayName: string;
  extension: string | null;
  sizeBytes: number;
  status: string;
  failureReason: string | null;
  pageCount: number | null;
  chunkCount: number | null;
  createdAt: string;
}

interface BaseInfo {
  id: string;
  name: string;
  description: string | null;
  organizationId: string | null;
}

const ACCEPT = '.pdf,.docx,.txt,.md,.csv';
const PENDING = new Set(['UPLOADED', 'PROCESSING', 'QUEUED']);

function formatBytes(bytes: number): string {
  if (!bytes || bytes < 0) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(kb < 10 ? 1 : 0)} KB`;
  const mb = kb / 1024;
  return `${mb.toFixed(mb < 10 ? 1 : 0)} MB`;
}

export function KnowledgeBaseDetail({
  locale,
  dict,
  kbId,
}: {
  locale: Locale;
  dict: Dictionary;
  kbId: string;
}) {
  const router = useRouter();
  const [base, setBase] = useState<BaseInfo | null>(null);
  const [canEdit, setCanEdit] = useState(false);
  const [documents, setDocuments] = useState<DocumentRow[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [nameDraft, setNameDraft] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  const fmtDate = new Intl.DateTimeFormat(locale === 'ar' ? 'ar-AE' : 'en-US', { dateStyle: 'medium' });

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch(`/api/knowledge/${kbId}`, { cache: 'no-store' });
      if (!res.ok) throw new Error();
      const data = await res.json();
      setBase(data.knowledgeBase ?? null);
      setCanEdit(Boolean(data.canEdit));
      setDocuments(data.documents ?? []);
    } catch {
      setError(dict.common.somethingWrong);
    } finally {
      setLoaded(true);
    }
  }, [kbId, dict]);

  const refreshDocs = useCallback(async () => {
    try {
      const res = await fetch(`/api/knowledge/${kbId}/documents`, { cache: 'no-store' });
      if (!res.ok) return;
      const data = await res.json();
      setDocuments(data.documents ?? []);
    } catch {
      /* keep last known state */
    }
  }, [kbId]);

  useEffect(() => {
    void load();
  }, [load]);

  // Poll while any document is still being processed.
  const anyPending = documents.some((d) => PENDING.has(d.status));
  useEffect(() => {
    if (!anyPending) return;
    const timer = setInterval(() => {
      void refreshDocs();
    }, 2000);
    return () => clearInterval(timer);
  }, [anyPending, refreshDocs]);

  async function onUpload(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const file = fileRef.current?.files?.[0];
    if (!file || uploading) return;
    setUploading(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const res = await fetch(`/api/knowledge/${kbId}/documents`, { method: 'POST', body: fd });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error || dict.common.somethingWrong);
        return;
      }
      if (fileRef.current) fileRef.current.value = '';
      await refreshDocs();
    } catch {
      setError(dict.common.somethingWrong);
    } finally {
      setUploading(false);
    }
  }

  async function saveName() {
    const next = nameDraft.trim();
    if (!next) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/knowledge/${kbId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: next }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error || dict.common.somethingWrong);
        return;
      }
      setRenaming(false);
      await load();
    } catch {
      setError(dict.common.somethingWrong);
    } finally {
      setBusy(false);
    }
  }

  async function deleteBase() {
    if (!window.confirm(dict.knowledge.deleteBaseConfirm)) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/knowledge/${kbId}`, { method: 'DELETE' });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error || dict.common.somethingWrong);
        setBusy(false);
        return;
      }
      router.push(`/${locale}/app/knowledge`);
      router.refresh();
    } catch {
      setError(dict.common.somethingWrong);
      setBusy(false);
    }
  }

  async function removeDoc(fileId: string) {
    if (!window.confirm(dict.knowledge.removeConfirm)) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/knowledge/${kbId}/documents/${fileId}`, { method: 'DELETE' });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error || dict.common.somethingWrong);
        return;
      }
      await refreshDocs();
    } catch {
      setError(dict.common.somethingWrong);
    } finally {
      setBusy(false);
    }
  }

  async function retryDoc(fileId: string) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/knowledge/${kbId}/documents/${fileId}/reprocess`, {
        method: 'POST',
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error || dict.common.somethingWrong);
        return;
      }
      await refreshDocs();
    } catch {
      setError(dict.common.somethingWrong);
    } finally {
      setBusy(false);
    }
  }

  function statusLabel(status: string): string {
    switch (status) {
      case 'UPLOADED':
        return dict.knowledge.statusUploaded;
      case 'PROCESSING':
      case 'QUEUED':
        return dict.knowledge.statusProcessing;
      case 'READY':
        return dict.knowledge.statusReady;
      case 'FAILED':
        return dict.knowledge.statusFailed;
      case 'UNSUPPORTED':
        return dict.knowledge.statusUnsupported;
      default:
        return status;
    }
  }

  return (
    <div className="scroll-slim h-full overflow-y-auto">
      <div className="mx-auto max-w-4xl px-5 py-8">
        <Link
          href={`/${locale}/app/knowledge`}
          className="inline-flex items-center gap-1.5 text-sm text-ink-soft hover:text-ink"
        >
          <Icon name="files" width={14} height={14} />
          {dict.knowledge.bases}
        </Link>

        {/* Header */}
        <div className="mt-3 flex flex-wrap items-start justify-between gap-3">
          {renaming ? (
            <div className="flex flex-1 items-center gap-2">
              <input
                value={nameDraft}
                onChange={(e) => setNameDraft(e.target.value)}
                className="field max-w-sm"
                autoFocus
              />
              <button onClick={saveName} className="btn-primary" disabled={busy || !nameDraft.trim()}>
                {dict.common.save}
              </button>
              <button onClick={() => setRenaming(false)} className="btn-ghost" disabled={busy}>
                {dict.common.cancel}
              </button>
            </div>
          ) : (
            <div className="min-w-0">
              <h1 className="truncate text-2xl font-bold tracking-tight text-ink">
                {base?.name ?? dict.knowledge.title}
              </h1>
              {base?.description && <p className="mt-1 text-sm text-ink-soft">{base.description}</p>}
            </div>
          )}

          {canEdit && !renaming && (
            <div className="flex shrink-0 items-center gap-2">
              <button
                onClick={() => {
                  setNameDraft(base?.name ?? '');
                  setRenaming(true);
                }}
                className="btn-outline"
                disabled={busy}
              >
                <Icon name="edit" width={14} height={14} />
                {dict.knowledge.rename}
              </button>
              <button onClick={deleteBase} className="btn-ghost text-danger" disabled={busy}>
                <Icon name="trash" width={14} height={14} />
                {dict.knowledge.deleteBase}
              </button>
            </div>
          )}
        </div>

        {error && (
          <p role="alert" className="mt-4 rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger">
            {error}
          </p>
        )}

        {/* Upload */}
        {canEdit && (
          <form onSubmit={onUpload} className="card mt-6 p-5">
            <h2 className="text-sm font-semibold text-ink">{dict.knowledge.upload}</h2>
            <p className="mt-1 text-xs text-ink-faint">{dict.knowledge.allowedTypes}</p>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <input
                ref={fileRef}
                type="file"
                accept={ACCEPT}
                aria-label={dict.knowledge.chooseFile}
                className="scroll-slim block max-w-full text-sm text-ink-soft file:me-3 file:rounded-lg file:border-0 file:bg-paper-sunken file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-ink hover:file:bg-line"
              />
              <button type="submit" className="btn-primary" disabled={uploading}>
                {uploading ? dict.knowledge.uploading : dict.knowledge.upload}
              </button>
            </div>
          </form>
        )}

        {/* Documents */}
        <h2 className="mt-6 text-sm font-semibold text-ink-soft">{dict.knowledge.documents}</h2>
        <p className="mt-1 text-xs text-ink-faint">{dict.knowledge.notReadyNote}</p>

        {loaded && documents.length === 0 ? (
          <p className="mt-3 rounded-xl border border-dashed border-line px-4 py-8 text-center text-sm text-ink-soft">
            {dict.knowledge.empty}
          </p>
        ) : (
          <section className="card mt-3 p-5">
            <div className="overflow-x-auto">
              <table className="w-full text-start text-sm">
                <thead>
                  <tr className="text-xs uppercase tracking-wide text-ink-faint">
                    <th className="px-2 py-1 text-start font-medium">{dict.knowledge.name}</th>
                    <th className="px-2 py-1 text-start font-medium">{dict.knowledge.type}</th>
                    <th className="px-2 py-1 text-start font-medium">{dict.knowledge.size}</th>
                    <th className="px-2 py-1 text-start font-medium">{dict.knowledge.statusLabel}</th>
                    <th className="px-2 py-1 text-start font-medium">{dict.knowledge.uploaded}</th>
                    {canEdit && <th className="px-2 py-1 text-start font-medium">{dict.knowledge.remove}</th>}
                  </tr>
                </thead>
                <tbody className="text-ink-soft">
                  {documents.map((d) => {
                    const pending = PENDING.has(d.status);
                    return (
                      <tr key={d.id} className="border-t border-line align-top">
                        <td className="px-2 py-2">
                          <span className="text-ink">{d.displayName}</span>
                        </td>
                        <td className="px-2 py-2">{(d.extension ?? '').toUpperCase()}</td>
                        <td className="px-2 py-2">{formatBytes(d.sizeBytes)}</td>
                        <td className="px-2 py-2">
                          <span className="inline-flex items-center gap-1.5">
                            {pending && (
                              <span className="h-3.5 w-3.5 shrink-0 animate-spin rounded-full border-2 border-line-strong border-t-accent" />
                            )}
                            <span className={d.status === 'FAILED' ? 'text-danger' : 'text-ink'}>
                              {statusLabel(d.status)}
                            </span>
                          </span>
                          {d.status === 'READY' && (
                            <span className="mt-0.5 block text-xs text-ink-faint">
                              {(d.pageCount ?? 0)} {dict.knowledge.pages} · {(d.chunkCount ?? 0)}{' '}
                              {dict.knowledge.chunks}
                            </span>
                          )}
                          {d.status === 'FAILED' && d.failureReason && (
                            <span className="mt-0.5 block text-xs text-danger">{d.failureReason}</span>
                          )}
                          {d.status === 'UNSUPPORTED' && (
                            <span className="mt-0.5 block text-xs text-ink-faint">
                              {d.failureReason || dict.knowledge.scannedNote}
                            </span>
                          )}
                        </td>
                        <td className="px-2 py-2">{fmtDate.format(new Date(d.createdAt))}</td>
                        {canEdit && (
                          <td className="px-2 py-2">
                            <div className="flex flex-wrap gap-1.5">
                              {d.status === 'FAILED' && (
                                <button
                                  onClick={() => retryDoc(d.id)}
                                  className="btn-ghost text-accent"
                                  disabled={busy}
                                >
                                  {dict.knowledge.retry}
                                </button>
                              )}
                              <button
                                onClick={() => removeDoc(d.id)}
                                className="btn-ghost text-danger"
                                disabled={busy}
                              >
                                {dict.knowledge.remove}
                              </button>
                            </div>
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
