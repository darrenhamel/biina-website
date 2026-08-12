'use client';

import { useCallback, useEffect, useState } from 'react';
import type { Locale } from '@/i18n/config';
import type { Dictionary } from '@/i18n/dictionaries';

interface AdminConnector {
  slug: string;
  displayName: string;
  providerType: string;
  category: string;
  enabled: boolean;
  supportsOAuth: boolean;
  oauthConfigured: boolean;
  activeConnections: number;
  erroredConnections: number;
  capabilities: string[];
}

interface AdminConnectorsData {
  writeActionsEnabled: boolean;
  encryptionConfigured: boolean;
  connectors: AdminConnector[];
  usage24h: { operations: number; failures: number };
}

export function AdminConnectorsPanel({ locale, dict }: { locale: Locale; dict: Dictionary }) {
  const [data, setData] = useState<AdminConnectorsData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const num = new Intl.NumberFormat(locale === 'ar' ? 'ar-AE' : 'en-US');

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch('/api/admin/connectors', { cache: 'no-store' });
      if (!res.ok) throw new Error();
      setData(await res.json());
    } catch {
      setError(dict.common.somethingWrong);
    }
  }, [dict]);

  useEffect(() => {
    void load();
  }, [load]);

  async function toggle(connector: AdminConnector) {
    setBusy(connector.slug);
    try {
      const res = await fetch(`/api/admin/connectors/${connector.slug}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: !connector.enabled }),
      });
      if (!res.ok) throw new Error();
      await load();
    } catch {
      setError(dict.common.somethingWrong);
    } finally {
      setBusy(null);
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

  const tiles: Array<{ label: string; value: string }> = [
    { label: dict.adminConnectors.operations24h, value: num.format(data.usage24h.operations) },
    { label: dict.adminConnectors.failures, value: num.format(data.usage24h.failures) },
  ];

  return (
    <div className="scroll-slim h-full overflow-y-auto">
      <div className="mx-auto max-w-4xl px-5 py-8">
        <h1 className="text-2xl font-bold tracking-tight text-ink">{dict.adminConnectors.title}</h1>
        <p className="mt-1 text-sm text-ink-soft">{dict.adminConnectors.subtitle}</p>

        {error && (
          <p className="mt-4 rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger">{error}</p>
        )}

        {/* Platform flags */}
        <section className="card mt-6 p-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex items-center justify-between">
              <p className="text-xs text-ink-soft">{dict.adminConnectors.writeActions}</p>
              <span
                className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                  data.writeActionsEnabled ? 'bg-success/15 text-success' : 'bg-paper-sunken text-ink-soft'
                }`}
              >
                {data.writeActionsEnabled ? dict.adminConnectors.on : dict.adminConnectors.off}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <p className="text-xs text-ink-soft">{dict.adminConnectors.encryption}</p>
              <span
                className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                  data.encryptionConfigured ? 'bg-success/15 text-success' : 'bg-danger/10 text-danger'
                }`}
              >
                {data.encryptionConfigured ? dict.adminConnectors.on : dict.adminConnectors.off}
              </span>
            </div>
          </div>
        </section>

        {/* Usage tiles */}
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          {tiles.map((t) => (
            <div key={t.label} className="rounded-xl border border-line p-4">
              <p className="truncate text-xl font-bold text-ink">{t.value}</p>
              <p className="mt-0.5 text-xs text-ink-soft">{t.label}</p>
            </div>
          ))}
        </div>

        {/* Connector registry */}
        <section className="card mt-4 p-5">
          <h2 className="mb-3 text-sm font-semibold text-ink">{dict.adminConnectors.title}</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-start text-sm">
              <thead>
                <tr className="text-xs uppercase tracking-wide text-ink-faint">
                  <th className="px-2 py-1 text-start font-medium">{dict.adminConnectors.connector}</th>
                  <th className="px-2 py-1 text-start font-medium">{dict.adminConnectors.provider}</th>
                  <th className="px-2 py-1 text-start font-medium">{dict.adminConnectors.category}</th>
                  <th className="px-2 py-1 text-start font-medium">{dict.adminConnectors.oauthConfigured}</th>
                  <th className="px-2 py-1 text-start font-medium">{dict.adminConnectors.activeConnections}</th>
                  <th className="px-2 py-1 text-start font-medium">{dict.adminConnectors.errors}</th>
                  <th className="px-2 py-1 text-start font-medium">{dict.adminConnectors.capabilities}</th>
                  <th className="px-2 py-1 text-start font-medium">{dict.adminConnectors.enabled}</th>
                </tr>
              </thead>
              <tbody className="text-ink-soft">
                {data.connectors.map((c) => (
                  <tr key={c.slug} className="border-t border-line align-top">
                    <td className="px-2 py-2 font-medium text-ink">{c.displayName}</td>
                    <td className="px-2 py-2">{c.providerType}</td>
                    <td className="px-2 py-2">{c.category}</td>
                    <td className="px-2 py-2">
                      {c.supportsOAuth
                        ? c.oauthConfigured
                          ? dict.adminConnectors.on
                          : dict.adminConnectors.off
                        : '—'}
                    </td>
                    <td className="px-2 py-2">{num.format(c.activeConnections)}</td>
                    <td className="px-2 py-2">
                      {c.erroredConnections > 0 ? (
                        <span className="text-danger">{num.format(c.erroredConnections)}</span>
                      ) : (
                        num.format(c.erroredConnections)
                      )}
                    </td>
                    <td className="px-2 py-2 text-xs text-ink-faint">{c.capabilities.join(', ') || '—'}</td>
                    <td className="px-2 py-2">
                      <button
                        onClick={() => toggle(c)}
                        className="btn-ghost px-2.5 py-1 text-xs"
                        disabled={busy === c.slug}
                        aria-pressed={c.enabled}
                      >
                        {c.enabled ? dict.adminConnectors.enabled : dict.adminConnectors.disabled}
                      </button>
                    </td>
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
