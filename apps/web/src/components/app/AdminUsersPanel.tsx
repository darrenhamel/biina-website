'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import type { Locale } from '@/i18n/config';
import type { Dictionary } from '@/i18n/dictionaries';

type PlatformStatus = 'ACTIVE' | 'SUSPENDED' | 'DISABLED';
type PlatformRole = 'USER' | 'ADMIN' | 'SUPER_ADMIN';

interface UserRow {
  id: string;
  email: string;
  role: PlatformRole;
  plan: string;
  status: PlatformStatus;
  emailVerified: boolean;
  createdAt: string;
}

const ROLE_OPTIONS: PlatformRole[] = ['USER', 'ADMIN', 'SUPER_ADMIN'];

export function AdminUsersPanel({
  locale,
  dict,
  canChangeRoles,
  selfId,
}: {
  locale: Locale;
  dict: Dictionary;
  canChangeRoles: boolean;
  selfId: string;
}) {
  const [users, setUsers] = useState<UserRow[]>([]);
  const [query, setQuery] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async (q: string) => {
    setError(null);
    try {
      const res = await fetch(`/api/admin/users?q=${encodeURIComponent(q)}`, { cache: 'no-store' });
      if (!res.ok) throw new Error();
      const data = await res.json();
      setUsers(data.users ?? []);
    } catch {
      setError(dict.common.somethingWrong);
    }
  }, [dict]);

  useEffect(() => {
    void load('');
  }, [load]);

  function onSearch(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    void load(query);
  }

  async function setStatus(id: string, status: PlatformStatus) {
    let reason: string | undefined;
    if (status !== 'ACTIVE') {
      reason = window.prompt(dict.adminUsers.reason) ?? undefined;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/users/${id}/status`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(reason ? { status, reason } : { status }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error || dict.common.somethingWrong);
      }
      await load(query);
    } finally {
      setBusy(false);
    }
  }

  async function setRole(id: string, role: PlatformRole) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/users/${id}/role`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error || dict.common.somethingWrong);
      }
      await load(query);
    } finally {
      setBusy(false);
    }
  }

  const fmt = new Intl.DateTimeFormat(locale === 'ar' ? 'ar-AE' : 'en-US', { dateStyle: 'medium' });

  function statusLabel(status: PlatformStatus) {
    if (status === 'ACTIVE') return dict.adminUsers.active;
    if (status === 'SUSPENDED') return dict.adminUsers.suspended;
    return dict.adminUsers.disabled;
  }

  return (
    <div className="scroll-slim h-full overflow-y-auto">
      <div className="mx-auto max-w-4xl px-5 py-8">
        <h1 className="text-2xl font-bold tracking-tight text-ink">{dict.adminUsers.title}</h1>
        <p className="mt-1 text-sm text-ink-soft">{dict.adminUsers.subtitle}</p>

        <form onSubmit={onSearch} className="mt-4 flex gap-2">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={dict.adminUsers.search}
            className="field max-w-xs"
          />
          <button type="submit" className="btn" disabled={busy}>
            {dict.adminUsers.search}
          </button>
        </form>

        {error && <p className="mt-3 rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger">{error}</p>}

        <section className="card mt-4 p-5">
          <div className="overflow-x-auto">
            <table className="w-full text-start text-sm">
              <thead>
                <tr className="text-xs uppercase tracking-wide text-ink-faint">
                  <th className="px-2 py-1 text-start font-medium">{dict.adminUsers.email}</th>
                  <th className="px-2 py-1 text-start font-medium">{dict.adminUsers.role}</th>
                  <th className="px-2 py-1 text-start font-medium">{dict.adminUsers.plan}</th>
                  <th className="px-2 py-1 text-start font-medium">{dict.adminUsers.status}</th>
                  <th className="px-2 py-1 text-start font-medium">{dict.adminUsers.verified}</th>
                  <th className="px-2 py-1 text-start font-medium">{dict.adminUsers.joined}</th>
                  <th className="px-2 py-1 text-start font-medium">{dict.adminUsers.actions}</th>
                </tr>
              </thead>
              <tbody className="text-ink-soft">
                {users.map((u) => {
                  const isSelf = u.id === selfId;
                  return (
                    <tr key={u.id} className="border-t border-line align-top">
                      <td className="px-2 py-2">
                        <span className="text-ink">{u.email}</span>
                        {isSelf && (
                          <span className="ms-2 rounded-full bg-accent-soft px-2 py-0.5 text-xs font-medium text-accent">
                            {dict.adminUsers.self}
                          </span>
                        )}
                      </td>
                      <td className="px-2 py-2">
                        {canChangeRoles && !isSelf ? (
                          <select
                            value={u.role}
                            disabled={busy}
                            onChange={(e) => setRole(u.id, e.target.value as PlatformRole)}
                            className="rounded-lg border border-line bg-paper-raised px-2 py-1 text-xs text-ink focus:border-accent focus:outline-none"
                          >
                            {ROLE_OPTIONS.map((r) => (
                              <option key={r} value={r}>
                                {r}
                              </option>
                            ))}
                          </select>
                        ) : (
                          u.role
                        )}
                      </td>
                      <td className="px-2 py-2">{u.plan}</td>
                      <td className="px-2 py-2">{statusLabel(u.status)}</td>
                      <td className="px-2 py-2">{u.emailVerified ? dict.adminUsers.yes : dict.adminUsers.no}</td>
                      <td className="px-2 py-2">{fmt.format(new Date(u.createdAt))}</td>
                      <td className="px-2 py-2">
                        {isSelf ? (
                          <span className="text-xs text-ink-faint">{dict.adminUsers.self}</span>
                        ) : (
                          <div className="flex flex-wrap gap-1.5">
                            {u.status === 'ACTIVE' ? (
                              <>
                                <button
                                  onClick={() => setStatus(u.id, 'SUSPENDED')}
                                  className="btn-ghost text-danger"
                                  disabled={busy}
                                >
                                  {dict.adminUsers.suspend}
                                </button>
                                <button
                                  onClick={() => setStatus(u.id, 'DISABLED')}
                                  className="btn-ghost text-danger"
                                  disabled={busy}
                                >
                                  {dict.adminUsers.disable}
                                </button>
                              </>
                            ) : (
                              <button
                                onClick={() => setStatus(u.id, 'ACTIVE')}
                                className="btn-ghost text-accent"
                                disabled={busy}
                              >
                                {dict.adminUsers.reactivate}
                              </button>
                            )}
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </div>
  );
}
