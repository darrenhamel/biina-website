'use client';

import { useCallback, useEffect, useState } from 'react';
import type { Locale } from '@/i18n/config';
import type { Dictionary } from '@/i18n/dictionaries';

type OrgStatus = 'ACTIVE' | 'SUSPENDED';

interface OrgRow {
  id: string;
  slug: string;
  displayName: string;
  status: OrgStatus;
  createdAt: string;
  members: number;
  ownerEmail: string | null;
}

export function AdminOrgsPanel({ locale, dict }: { locale: Locale; dict: Dictionary }) {
  const [orgs, setOrgs] = useState<OrgRow[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch('/api/admin/orgs', { cache: 'no-store' });
      if (!res.ok) throw new Error();
      const data = await res.json();
      setOrgs(data.organizations ?? []);
    } catch {
      setError(dict.common.somethingWrong);
    } finally {
      setLoaded(true);
    }
  }, [dict]);

  useEffect(() => {
    void load();
  }, [load]);

  async function setStatus(id: string, status: OrgStatus) {
    let reason: string | undefined;
    if (status === 'SUSPENDED') {
      reason = window.prompt(dict.adminUsers.reason) ?? undefined;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/orgs/${id}/status`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(reason ? { status, reason } : { status }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error || dict.common.somethingWrong);
      }
      await load();
    } finally {
      setBusy(false);
    }
  }

  const fmt = new Intl.DateTimeFormat(locale === 'ar' ? 'ar-AE' : 'en-US', { dateStyle: 'medium' });

  return (
    <div className="scroll-slim h-full overflow-y-auto">
      <div className="mx-auto max-w-4xl px-5 py-8">
        <h1 className="text-2xl font-bold tracking-tight text-ink">{dict.adminOrgs.title}</h1>
        <p className="mt-1 text-sm text-ink-soft">{dict.adminOrgs.subtitle}</p>

        {error && <p className="mt-3 rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger">{error}</p>}

        {loaded && orgs.length === 0 ? (
          <p className="mt-6 text-sm text-ink-soft">{dict.adminOrgs.none}</p>
        ) : (
          <section className="card mt-4 p-5">
            <div className="overflow-x-auto">
              <table className="w-full text-start text-sm">
                <thead>
                  <tr className="text-xs uppercase tracking-wide text-ink-faint">
                    <th className="px-2 py-1 text-start font-medium">{dict.adminOrgs.name}</th>
                    <th className="px-2 py-1 text-start font-medium">{dict.adminOrgs.owner}</th>
                    <th className="px-2 py-1 text-start font-medium">{dict.adminOrgs.members}</th>
                    <th className="px-2 py-1 text-start font-medium">{dict.adminOrgs.status}</th>
                    <th className="px-2 py-1 text-start font-medium">{dict.adminOrgs.created}</th>
                    <th className="px-2 py-1 text-start font-medium" />
                  </tr>
                </thead>
                <tbody className="text-ink-soft">
                  {orgs.map((o) => (
                    <tr key={o.id} className="border-t border-line">
                      <td className="px-2 py-2">
                        <span className="text-ink">{o.displayName}</span>
                        <span className="block text-xs text-ink-faint">{o.slug}</span>
                      </td>
                      <td className="px-2 py-2">{o.ownerEmail ?? '—'}</td>
                      <td className="px-2 py-2">{o.members}</td>
                      <td className="px-2 py-2">
                        {o.status === 'ACTIVE' ? dict.adminOrgs.active : dict.adminOrgs.suspended}
                      </td>
                      <td className="px-2 py-2">{fmt.format(new Date(o.createdAt))}</td>
                      <td className="px-2 py-2">
                        {o.status === 'ACTIVE' ? (
                          <button
                            onClick={() => setStatus(o.id, 'SUSPENDED')}
                            className="btn-ghost text-danger"
                            disabled={busy}
                          >
                            {dict.adminOrgs.suspend}
                          </button>
                        ) : (
                          <button
                            onClick={() => setStatus(o.id, 'ACTIVE')}
                            className="btn-ghost text-accent"
                            disabled={busy}
                          >
                            {dict.adminOrgs.reactivate}
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
