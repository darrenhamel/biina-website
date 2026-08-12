'use client';

import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import type { Locale } from '@/i18n/config';
import type { Dictionary } from '@/i18n/dictionaries';
import { Icon } from '@/components/Icon';

type Workspace = 'personal' | 'organization';

interface Connector {
  slug: string;
  displayName: string;
  category: string;
  providerType: string;
  enabled: boolean;
  supportsPersonal: boolean;
  supportsOrganization: boolean;
  capabilities: string[];
}

interface Connection {
  id: string;
  connectorSlug: string;
  connectionType: 'PERSONAL' | 'ORGANIZATION';
  status: string;
  externalAccountEmail: string | null;
  externalAccountName: string | null;
  capabilities: string[];
  connectedAt: string | null;
  lastUsedAt: string | null;
}

interface ConnectorsData {
  connectorsEnabled: boolean;
  workspace: Workspace;
  connectors: Connector[];
  personalConnections: Connection[];
  organizationConnections: Connection[];
}

function statusLabel(status: string, dict: Dictionary): string {
  if (status === 'ACTIVE') return dict.connectors.connected;
  if (status === 'REAUTH_REQUIRED') return dict.connectors.reauthRequired;
  return status;
}

export function ConnectionsPanel({ locale, dict }: { locale: Locale; dict: Dictionary }) {
  const searchParams = useSearchParams();
  const [data, setData] = useState<ConnectorsData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [banner, setBanner] = useState<'success' | 'error' | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch('/api/connectors', { cache: 'no-store' });
      if (!res.ok) throw new Error();
      setData(await res.json());
    } catch {
      setError(dict.common.somethingWrong);
    }
  }, [dict]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const connect = searchParams.get('connect');
    if (connect === 'success' || connect === 'error') setBanner(connect);
  }, [searchParams]);

  const fmtDate = new Intl.DateTimeFormat(locale === 'ar' ? 'ar-AE' : 'en-US', {
    dateStyle: 'medium',
  });

  async function connect(slug: string, connectionType: 'PERSONAL' | 'ORGANIZATION') {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/connectors/${slug}/connect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ connectionType }),
      });
      if (res.status === 403) {
        setError(dict.connectors.unavailable);
        setBusy(false);
        return;
      }
      if (!res.ok) {
        setError(dict.common.somethingWrong);
        setBusy(false);
        return;
      }
      const body = await res.json().catch(() => ({}));
      if (body.authorizationUrl) {
        window.location.href = body.authorizationUrl;
        return;
      }
      setError(dict.common.somethingWrong);
    } catch {
      setError(dict.common.somethingWrong);
    }
    setBusy(false);
  }

  async function disconnect(id: string) {
    if (!window.confirm(dict.connectors.disconnectConfirm)) return;
    setBusy(true);
    try {
      await fetch(`/api/connections/${id}`, { method: 'DELETE' });
      await load();
    } finally {
      setBusy(false);
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

  const isOrg = data.workspace === 'organization';
  const connections = isOrg ? data.organizationConnections : data.personalConnections;
  const connectionType: 'PERSONAL' | 'ORGANIZATION' = isOrg ? 'ORGANIZATION' : 'PERSONAL';

  return (
    <div className="scroll-slim h-full overflow-y-auto">
      <div className="mx-auto max-w-2xl px-5 py-8">
        <h1 className="text-2xl font-bold tracking-tight text-ink">
          {isOrg ? dict.connectors.orgTitle : dict.connectors.title}
        </h1>
        <p className="mt-1 text-sm text-ink-soft">
          {isOrg ? dict.connectors.orgSubtitle : dict.connectors.subtitle}
        </p>

        {banner === 'success' && (
          <p role="status" className="mt-4 rounded-lg bg-success/15 px-3 py-2 text-sm text-success">
            {dict.connectors.connectSuccess}
          </p>
        )}
        {banner === 'error' && (
          <p role="alert" className="mt-4 rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger">
            {dict.connectors.connectError}
          </p>
        )}

        {!data.connectorsEnabled && (
          <p className="mt-4 rounded-lg bg-paper-sunken px-3 py-2 text-sm text-ink-soft">
            {dict.connectors.unavailable}
          </p>
        )}

        {error && (
          <p role="alert" className="mt-4 rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger">
            {error}
          </p>
        )}

        <div className="mt-6 space-y-4">
          {data.connectors.map((connector) => {
            const connection = connections.find((c) => c.connectorSlug === connector.slug);
            const supported = isOrg ? connector.supportsOrganization : connector.supportsPersonal;
            const canConnect = connector.enabled && data.connectorsEnabled && supported;
            return (
              <ConnectorCard
                key={connector.slug}
                dict={dict}
                connector={connector}
                connection={connection}
                canConnect={canConnect}
                busy={busy}
                fmtDate={fmtDate}
                onConnect={() => connect(connector.slug, connectionType)}
                onDisconnect={connection ? () => disconnect(connection.id) : undefined}
              />
            );
          })}
        </div>
      </div>
    </div>
  );
}

function ConnectorCard({
  dict,
  connector,
  connection,
  canConnect,
  busy,
  fmtDate,
  onConnect,
  onDisconnect,
}: {
  dict: Dictionary;
  connector: Connector;
  connection: Connection | undefined;
  canConnect: boolean;
  busy: boolean;
  fmtDate: Intl.DateTimeFormat;
  onConnect: () => void;
  onDisconnect?: () => void;
}) {
  const caps = connector.capabilities.map((c) => c.toLowerCase());
  const canSearch = caps.some((c) => c.includes('search'));
  const canRead = caps.some((c) => c.includes('read'));
  const account =
    connection?.externalAccountEmail || connection?.externalAccountName || null;
  const needsReauth = connection?.status === 'REAUTH_REQUIRED';

  return (
    <section className="card p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-ink">{connector.displayName}</h2>
          <p className="mt-0.5 text-xs text-ink-faint">{connector.category}</p>
          <span className="mt-2 inline-flex items-center gap-1 rounded-full bg-accent-soft px-2 py-0.5 text-[11px] font-medium text-accent">
            <Icon name="shield" width={12} height={12} />
            {dict.connectors.readOnly}
          </span>
        </div>
        <div className="shrink-0">
          {connection ? (
            <span
              className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                connection.status === 'ACTIVE'
                  ? 'bg-success/15 text-success'
                  : 'bg-danger/10 text-danger'
              }`}
            >
              {statusLabel(connection.status, dict)}
            </span>
          ) : canConnect ? (
            <span className="rounded-full bg-paper-sunken px-2.5 py-0.5 text-xs font-medium text-ink-soft">
              {dict.connectors.available}
            </span>
          ) : (
            <span className="rounded-full bg-paper-sunken px-2.5 py-0.5 text-xs font-medium text-ink-faint">
              {dict.connectors.comingSoon}
            </span>
          )}
        </div>
      </div>

      {connection && (
        <dl className="mt-3 grid gap-2 text-xs sm:grid-cols-2">
          {account && (
            <div>
              <dt className="text-ink-faint">{dict.connectors.account}</dt>
              <dd className="truncate font-medium text-ink">{account}</dd>
            </div>
          )}
          {connection.lastUsedAt && (
            <div>
              <dt className="text-ink-faint">{dict.connectors.lastUsed}</dt>
              <dd className="text-ink-soft">{fmtDate.format(new Date(connection.lastUsedAt))}</dd>
            </div>
          )}
        </dl>
      )}

      {/* Permissions summary */}
      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        <div className="rounded-xl border border-line px-3 py-2">
          <p className="text-xs font-semibold text-ink-soft">{dict.connectors.can}</p>
          <ul className="mt-1 space-y-0.5 text-xs text-ink-soft">
            {canSearch && (
              <li className="flex items-center gap-1.5">
                <Icon name="check" width={12} height={12} />
                {dict.connectors.capSearch}
              </li>
            )}
            {canRead && (
              <li className="flex items-center gap-1.5">
                <Icon name="check" width={12} height={12} />
                {dict.connectors.capRead}
              </li>
            )}
          </ul>
        </div>
        <div className="rounded-xl border border-line px-3 py-2">
          <p className="text-xs font-semibold text-ink-soft">{dict.connectors.cannot}</p>
          <ul className="mt-1 space-y-0.5 text-xs text-ink-faint">
            <li className="flex items-center gap-1.5">
              <Icon name="close" width={12} height={12} />
              {dict.connectors.capWrite}
            </li>
          </ul>
        </div>
      </div>

      <div className="mt-4 flex items-center gap-2">
        {connection ? (
          <>
            {needsReauth && (
              <button onClick={onConnect} className="btn-primary px-3 py-1.5 text-xs" disabled={busy}>
                {dict.connectors.reconnect}
              </button>
            )}
            {onDisconnect && (
              <button
                onClick={onDisconnect}
                className="btn-ghost px-3 py-1.5 text-xs text-danger"
                disabled={busy}
              >
                {dict.connectors.disconnect}
              </button>
            )}
          </>
        ) : canConnect ? (
          <button onClick={onConnect} className="btn-primary px-3 py-1.5 text-xs" disabled={busy}>
            {dict.connectors.connect}
          </button>
        ) : (
          <span className="text-xs text-ink-faint">{dict.connectors.comingSoon}</span>
        )}
      </div>
    </section>
  );
}
