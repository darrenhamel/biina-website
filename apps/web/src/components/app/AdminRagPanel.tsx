'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import type { Locale } from '@/i18n/config';
import type { Dictionary } from '@/i18n/dictionaries';
import { Icon } from '@/components/Icon';

interface Counts {
  totalFiles: number;
  documentsProcessed: number;
  failedProcessing: number;
  processing: number;
  totalChunks: number;
  knowledgeBases: number;
  storedBytes: number;
  ragRequests24h: number;
}
interface HealthEntry {
  ok: boolean;
  detail?: string;
}
interface DocumentRow {
  id: string;
  displayName: string;
  status: string;
  sizeBytes: number;
  extension: string | null;
  failureReason: string | null;
  createdAt: string;
  ownerEmail: string | null;
  organizationName: string | null;
}
interface RagData {
  counts: Counts;
  embedding: { provider: string; model: string; dimensions: number };
  vectorStore: string;
  health: {
    fileStorage: HealthEntry;
    embeddingProvider: HealthEntry;
    vectorStore: HealthEntry;
  };
  documents: DocumentRow[];
}

function formatBytes(bytes: number): string {
  if (!bytes || bytes < 0) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(kb < 10 ? 1 : 0)} KB`;
  const mb = kb / 1024;
  return `${mb.toFixed(mb < 10 ? 1 : 0)} MB`;
}

export function AdminRagPanel({ locale, dict }: { locale: Locale; dict: Dictionary }) {
  const [data, setData] = useState<RagData | null>(null);
  const [query, setQuery] = useState('');
  const [error, setError] = useState<string | null>(null);

  const fmtDate = new Intl.DateTimeFormat(locale === 'ar' ? 'ar-AE' : 'en-US', { dateStyle: 'medium' });

  const load = useCallback(
    async (q: string) => {
      setError(null);
      try {
        const res = await fetch(`/api/admin/rag?q=${encodeURIComponent(q)}`, { cache: 'no-store' });
        if (!res.ok) throw new Error();
        setData(await res.json());
      } catch {
        setError(dict.common.somethingWrong);
      }
    },
    [dict],
  );

  useEffect(() => {
    void load('');
  }, [load]);

  function onSearch(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    void load(query);
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

  if (!data) {
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

  const c = data.counts;
  const tiles: Array<{ label: string; value: string }> = [
    { label: dict.adminRag.documentsProcessed, value: String(c.documentsProcessed) },
    { label: dict.adminRag.failed, value: String(c.failedProcessing) },
    { label: dict.adminRag.processing, value: String(c.processing) },
    { label: dict.adminRag.totalFiles, value: String(c.totalFiles) },
    { label: dict.adminRag.totalChunks, value: String(c.totalChunks) },
    { label: dict.adminRag.knowledgeBases, value: String(c.knowledgeBases) },
    { label: dict.adminRag.storage, value: formatBytes(c.storedBytes) },
    { label: dict.adminRag.ragRequests, value: String(c.ragRequests24h) },
  ];

  const healthRows: Array<{ label: string; entry: HealthEntry }> = [
    { label: dict.adminRag.fileStorage, entry: data.health.fileStorage },
    { label: dict.adminRag.embeddingProvider, entry: data.health.embeddingProvider },
    { label: dict.adminRag.vectorStore, entry: data.health.vectorStore },
  ];

  return (
    <div className="scroll-slim h-full overflow-y-auto">
      <div className="mx-auto max-w-4xl px-5 py-8">
        <h1 className="text-2xl font-bold tracking-tight text-ink">{dict.adminRag.title}</h1>
        <p className="mt-1 text-sm text-ink-soft">{dict.adminRag.subtitle}</p>

        {error && (
          <p className="mt-4 rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger">{error}</p>
        )}

        {/* Stat tiles */}
        <div className="mt-6 grid gap-3 sm:grid-cols-4">
          {tiles.map((t) => (
            <div key={t.label} className="rounded-xl border border-line p-4">
              <p className="truncate text-xl font-bold text-ink">{t.value}</p>
              <p className="mt-0.5 text-xs text-ink-soft">{t.label}</p>
            </div>
          ))}
        </div>

        {/* Embedding / vector store */}
        <section className="card mt-4 p-5">
          <div className="grid gap-3 sm:grid-cols-4">
            <Detail label={dict.adminRag.embeddingProvider} value={data.embedding.provider} />
            <Detail label={dict.adminRag.embeddingModel} value={data.embedding.model} />
            <Detail label={dict.adminRag.dimensions} value={String(data.embedding.dimensions)} />
            <Detail label={dict.adminRag.vectorStore} value={data.vectorStore} />
          </div>
        </section>

        {/* Health */}
        <section className="card mt-4 p-5">
          <h2 className="mb-3 text-sm font-semibold text-ink">{dict.adminRag.health}</h2>
          <div className="divide-y divide-line">
            {healthRows.map((h) => (
              <div key={h.label} className="flex items-center gap-3 py-2.5">
                <span
                  className={`h-2.5 w-2.5 shrink-0 rounded-full ${h.entry.ok ? 'bg-success' : 'bg-danger'}`}
                />
                <span className="min-w-0 flex-1">
                  <span className="block text-sm text-ink">{h.label}</span>
                  {h.entry.detail && (
                    <span className="block text-xs text-ink-faint">{h.entry.detail}</span>
                  )}
                </span>
                <span className="text-xs text-ink-soft">
                  {h.entry.ok ? dict.adminRag.healthy : dict.adminRag.unhealthy}
                </span>
              </div>
            ))}
          </div>
        </section>

        {/* Documents (metadata only) */}
        <form onSubmit={onSearch} className="mt-6 flex gap-2">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={dict.adminRag.search}
            className="field max-w-xs"
          />
          <button type="submit" className="btn">
            <Icon name="search" width={14} height={14} />
            {dict.adminRag.search}
          </button>
        </form>

        <section className="card mt-4 p-5">
          <h2 className="mb-3 text-sm font-semibold text-ink">{dict.adminRag.documents}</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-start text-sm">
              <thead>
                <tr className="text-xs uppercase tracking-wide text-ink-faint">
                  <th className="px-2 py-1 text-start font-medium">{dict.knowledge.name}</th>
                  <th className="px-2 py-1 text-start font-medium">{dict.adminRag.owner}</th>
                  <th className="px-2 py-1 text-start font-medium">{dict.adminRag.organization}</th>
                  <th className="px-2 py-1 text-start font-medium">{dict.adminRag.statusLabel}</th>
                  <th className="px-2 py-1 text-start font-medium">{dict.adminRag.size}</th>
                  <th className="px-2 py-1 text-start font-medium">{dict.knowledge.uploaded}</th>
                </tr>
              </thead>
              <tbody className="text-ink-soft">
                {data.documents.map((d) => (
                  <tr key={d.id} className="border-t border-line align-top">
                    <td className="px-2 py-2">
                      <span className="text-ink">{d.displayName}</span>
                      {(d.extension ?? '') && (
                        <span className="ms-1 text-xs text-ink-faint">
                          {(d.extension ?? '').toUpperCase()}
                        </span>
                      )}
                    </td>
                    <td className="px-2 py-2">{d.ownerEmail ?? '—'}</td>
                    <td className="px-2 py-2">{d.organizationName ?? '—'}</td>
                    <td className="px-2 py-2">
                      <span className={d.status === 'FAILED' ? 'text-danger' : 'text-ink'}>
                        {statusLabel(d.status)}
                      </span>
                    </td>
                    <td className="px-2 py-2">{formatBytes(d.sizeBytes)}</td>
                    <td className="px-2 py-2">{fmtDate.format(new Date(d.createdAt))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </div>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-line p-4">
      <p className="truncate text-base font-bold text-ink">{value}</p>
      <p className="mt-0.5 text-xs text-ink-soft">{label}</p>
    </div>
  );
}
