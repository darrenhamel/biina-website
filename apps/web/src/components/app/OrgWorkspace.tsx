'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { Locale } from '@/i18n/config';
import type { Dictionary } from '@/i18n/dictionaries';

type OrgRole = 'OWNER' | 'ADMIN' | 'MEMBER';

interface OrgInfo {
  organization: { slug: string; displayName: string; status: string };
  role: OrgRole;
}
interface Member {
  userId: string;
  role: OrgRole;
  joinedAt: string;
  email: string;
  displayName: string | null;
}
interface Invitation {
  id: string;
  email: string;
  role: OrgRole;
  status: string;
  expiresAt: string;
  createdAt: string;
}
interface Usage {
  requests: number;
  tokens: number;
  cost: number;
  activeUsers: number;
}

const ROLE_OPTIONS: OrgRole[] = ['OWNER', 'ADMIN', 'MEMBER'];
const INVITE_ROLE_OPTIONS: OrgRole[] = ['MEMBER', 'ADMIN'];

function roleLabel(role: OrgRole, dict: Dictionary) {
  if (role === 'OWNER') return dict.org.roleOwner;
  if (role === 'ADMIN') return dict.org.roleAdmin;
  return dict.org.roleMember;
}

export function OrgWorkspace({
  slug,
  locale,
  dict,
  selfUserId,
}: {
  slug: string;
  locale: Locale;
  dict: Dictionary;
  selfUserId: string;
}) {
  const router = useRouter();
  const [info, setInfo] = useState<OrgInfo | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [loaded, setLoaded] = useState(false);

  const loadInfo = useCallback(async () => {
    try {
      const res = await fetch(`/api/orgs/${slug}`, { cache: 'no-store' });
      if (res.status === 404) {
        setNotFound(true);
        return;
      }
      if (!res.ok) return;
      setInfo(await res.json());
    } finally {
      setLoaded(true);
    }
  }, [slug]);

  useEffect(() => {
    void loadInfo();
  }, [loadInfo]);

  if (notFound) {
    return (
      <div className="grid h-full place-items-center px-6 text-center">
        <div className="max-w-sm">
          <p className="text-sm text-ink-soft">{dict.org.noOrgs}</p>
          <Link href={`/${locale}/app/organizations`} className="btn mt-4">
            {dict.nav.organizations}
          </Link>
        </div>
      </div>
    );
  }

  if (!loaded || !info) {
    return (
      <div className="grid h-full place-items-center">
        <span className="h-6 w-6 animate-spin rounded-full border-2 border-line-strong border-t-accent" />
      </div>
    );
  }

  const isManager = info.role === 'OWNER' || info.role === 'ADMIN';

  return (
    <div className="scroll-slim h-full overflow-y-auto">
      <div className="mx-auto max-w-2xl px-5 py-8">
        <Link href={`/${locale}/app/organizations`} className="text-sm text-ink-soft hover:text-accent">
          {dict.nav.organizations}
        </Link>
        <h1 className="mt-2 text-2xl font-bold tracking-tight text-ink">{info.organization.displayName}</h1>
        <p className="mt-1 text-sm text-ink-faint">{info.organization.slug}</p>

        {info.organization.status === 'SUSPENDED' && (
          <p className="mt-4 rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger">{dict.org.suspendedNote}</p>
        )}

        <div className="mt-6 space-y-6">
          <MembersSection slug={slug} dict={dict} locale={locale} orgRole={info.role} selfUserId={selfUserId} />
          {isManager && <InvitationsSection slug={slug} dict={dict} locale={locale} />}
          {isManager && <UsageSection slug={slug} dict={dict} locale={locale} />}
          {isManager && (
            <SettingsSection
              slug={slug}
              dict={dict}
              initialName={info.organization.displayName}
              onSaved={loadInfo}
            />
          )}
          {isManager && (
            <Link
              href={`/${locale}/app/org/administration`}
              className="card flex items-center justify-between p-5 transition-colors hover:border-accent"
            >
              <span>
                <span className="block text-sm font-semibold text-ink">{dict.enterprise.title}</span>
                <span className="mt-0.5 block text-sm text-ink-soft">{dict.enterprise.subtitle}</span>
              </span>
              <span className="text-ink-faint ltr:rotate-0 rtl:rotate-180">&rarr;</span>
            </Link>
          )}
          <LeaveSection slug={slug} dict={dict} locale={locale} />
        </div>
      </div>
    </div>
  );
}

function MembersSection({
  slug,
  dict,
  locale,
  orgRole,
  selfUserId,
}: {
  slug: string;
  dict: Dictionary;
  locale: Locale;
  orgRole: OrgRole;
  selfUserId: string;
}) {
  const [members, setMembers] = useState<Member[]>([]);
  const [myRole, setMyRole] = useState<OrgRole>(orgRole);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch(`/api/orgs/${slug}/members`, { cache: 'no-store' });
      if (!res.ok) throw new Error();
      const data = await res.json();
      setMembers(data.members ?? []);
      if (data.myRole) setMyRole(data.myRole);
    } catch {
      setError(dict.common.somethingWrong);
    }
  }, [slug, dict]);

  useEffect(() => {
    void load();
  }, [load]);

  async function changeRole(userId: string, role: OrgRole) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/orgs/${slug}/members/${userId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role }),
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

  async function remove(userId: string) {
    if (!window.confirm(dict.org.removeConfirm)) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/orgs/${slug}/members/${userId}`, { method: 'DELETE' });
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
    <section className="card p-5">
      <h2 className="text-sm font-semibold text-ink">{dict.org.members}</h2>
      {error && <p className="mt-3 rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger">{error}</p>}
      <ul className="mt-3 divide-y divide-line">
        {members.map((m) => {
          const isSelf = m.userId === selfUserId;
          const canChangeRole = myRole === 'OWNER' && !isSelf;
          const canRemove =
            !isSelf && (myRole === 'OWNER' || (myRole === 'ADMIN' && m.role === 'MEMBER'));
          return (
            <li key={m.userId} className="flex items-center justify-between gap-3 py-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-ink">
                  {m.displayName || m.email}
                  {isSelf && (
                    <span className="ms-2 rounded-full bg-accent-soft px-2 py-0.5 text-xs font-medium text-accent">
                      {dict.org.you}
                    </span>
                  )}
                </p>
                <p className="mt-0.5 truncate text-xs text-ink-faint">
                  {m.email} · {dict.org.joined} {fmt.format(new Date(m.joinedAt))}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                {canChangeRole ? (
                  <select
                    value={m.role}
                    disabled={busy}
                    onChange={(e) => changeRole(m.userId, e.target.value as OrgRole)}
                    className="rounded-lg border border-line bg-paper-raised px-2 py-1 text-xs text-ink focus:border-accent focus:outline-none"
                  >
                    {ROLE_OPTIONS.map((r) => (
                      <option key={r} value={r}>
                        {roleLabel(r, dict)}
                      </option>
                    ))}
                  </select>
                ) : (
                  <span className="rounded-full bg-paper-sunken px-2.5 py-1 text-xs font-medium text-ink-soft">
                    {roleLabel(m.role, dict)}
                  </span>
                )}
                {canRemove && (
                  <button onClick={() => remove(m.userId)} className="btn-ghost text-danger" disabled={busy}>
                    {dict.org.remove}
                  </button>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function InvitationsSection({ slug, dict, locale }: { slug: string; dict: Dictionary; locale: Locale }) {
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [devLink, setDevLink] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch(`/api/orgs/${slug}/invitations`, { cache: 'no-store' });
      if (!res.ok) throw new Error();
      const data = await res.json();
      setInvitations(data.invitations ?? []);
    } catch {
      setError(dict.common.somethingWrong);
    }
  }, [slug, dict]);

  useEffect(() => {
    void load();
  }, [load]);

  async function invite(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setDevLink(null);
    const formEl = e.currentTarget;
    const form = new FormData(formEl);
    setBusy(true);
    try {
      const res = await fetch(`/api/orgs/${slug}/invitations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: form.get('email'), role: form.get('role') }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error || dict.common.somethingWrong);
        setBusy(false);
        return;
      }
      const data = await res.json().catch(() => ({}));
      setDevLink(data.devInviteLink ?? null);
      formEl.reset();
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function revoke(id: string) {
    setBusy(true);
    try {
      await fetch(`/api/orgs/${slug}/invitations/${id}`, { method: 'DELETE' });
      await load();
    } finally {
      setBusy(false);
    }
  }

  const fmt = new Intl.DateTimeFormat(locale === 'ar' ? 'ar-AE' : 'en-US', { dateStyle: 'medium' });
  const pending = invitations.filter((i) => i.status === 'PENDING' || i.status === 'pending');

  return (
    <section className="card p-5">
      <h2 className="text-sm font-semibold text-ink">{dict.org.invitations}</h2>

      <form onSubmit={invite} className="mt-3 flex flex-wrap items-end gap-2" noValidate>
        <div className="min-w-[12rem] flex-1">
          <label htmlFor="inviteEmail" className="mb-1.5 block text-sm text-ink-soft">
            {dict.org.inviteEmail}
          </label>
          <input id="inviteEmail" name="email" type="email" className="field" required />
        </div>
        <div>
          <label htmlFor="inviteRole" className="mb-1.5 block text-sm text-ink-soft">
            {dict.org.inviteRole}
          </label>
          <select
            id="inviteRole"
            name="role"
            defaultValue="MEMBER"
            className="rounded-lg border border-line bg-paper-raised px-3 py-2 text-sm text-ink focus:border-accent focus:outline-none"
          >
            {INVITE_ROLE_OPTIONS.map((r) => (
              <option key={r} value={r}>
                {roleLabel(r, dict)}
              </option>
            ))}
          </select>
        </div>
        <button type="submit" className="btn-primary" disabled={busy}>
          {dict.org.sendInvite}
        </button>
      </form>

      {error && <p className="mt-3 rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger">{error}</p>}
      {devLink && (
        <a href={devLink} className="mt-3 block break-all text-sm font-semibold text-accent hover:underline">
          {devLink}
        </a>
      )}

      <ul className="mt-3 divide-y divide-line">
        {pending.map((i) => (
          <li key={i.id} className="flex items-center justify-between gap-3 py-3">
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-ink">{i.email}</p>
              <p className="mt-0.5 text-xs text-ink-faint">
                {roleLabel(i.role, dict)} · {dict.org.expires} {fmt.format(new Date(i.expiresAt))}
              </p>
            </div>
            <button onClick={() => revoke(i.id)} className="btn-ghost shrink-0 text-danger" disabled={busy}>
              {dict.org.revokeInvite}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

function UsageSection({ slug, dict, locale }: { slug: string; dict: Dictionary; locale: Locale }) {
  const [usage, setUsage] = useState<Usage | null>(null);
  const nf = new Intl.NumberFormat(locale === 'ar' ? 'ar-AE' : 'en-US');

  useEffect(() => {
    fetch(`/api/orgs/${slug}/usage`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d) => setUsage(d.usage))
      .catch(() => setUsage(null));
  }, [slug]);

  if (!usage) return null;

  const tiles = [
    { label: dict.usage.requests, value: usage.requests },
    { label: dict.usage.tokens, value: usage.tokens },
    { label: dict.org.activeUsers, value: usage.activeUsers },
  ];

  return (
    <section className="card p-5">
      <h2 className="text-sm font-semibold text-ink">{dict.org.usage}</h2>
      <div className="mt-3 grid gap-3 sm:grid-cols-3">
        {tiles.map((t) => (
          <div key={t.label} className="rounded-xl bg-paper-sunken p-4">
            <p className="text-2xl font-bold text-ink">{nf.format(t.value)}</p>
            <p className="mt-1 text-sm text-ink-soft">{t.label}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

function SettingsSection({
  slug,
  dict,
  initialName,
  onSaved,
}: {
  slug: string;
  dict: Dictionary;
  initialName: string;
  onSaved: () => void;
}) {
  const [displayName, setDisplayName] = useState(initialName);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setBusy(true);
    setSaved(false);
    setError(null);
    try {
      const res = await fetch(`/api/orgs/${slug}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ displayName }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error || dict.common.somethingWrong);
        return;
      }
      setSaved(true);
      onSaved();
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card p-5">
      <h2 className="text-sm font-semibold text-ink">{dict.org.settings}</h2>
      <div className="mt-3 max-w-sm">
        <label htmlFor="orgDisplayName" className="mb-1.5 block text-sm text-ink-soft">
          {dict.org.name}
        </label>
        <input
          id="orgDisplayName"
          className="field"
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
        />
      </div>
      {error && <p className="mt-3 rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger">{error}</p>}
      <div className="mt-3 flex items-center gap-3">
        <button onClick={save} className="btn-primary" disabled={busy}>
          {busy ? dict.common.loading : dict.common.save}
        </button>
        {saved && (
          <span className="text-sm font-medium text-ink-soft" role="status">
            {dict.org.saved}
          </span>
        )}
      </div>
    </section>
  );
}

function LeaveSection({ slug, dict, locale }: { slug: string; dict: Dictionary; locale: Locale }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function leave() {
    if (!window.confirm(dict.org.leaveConfirm)) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/orgs/${slug}/leave`, { method: 'POST' });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error || dict.common.somethingWrong);
        setBusy(false);
        return;
      }
      router.push(`/${locale}/app/organizations`);
      router.refresh();
    } catch {
      setError(dict.common.somethingWrong);
      setBusy(false);
    }
  }

  return (
    <section className="card p-5">
      {error && <p className="mb-3 rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger">{error}</p>}
      <button onClick={leave} className="btn text-danger" disabled={busy}>
        {dict.org.leave}
      </button>
    </section>
  );
}
