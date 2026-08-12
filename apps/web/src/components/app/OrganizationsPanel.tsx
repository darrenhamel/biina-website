'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { Locale } from '@/i18n/config';
import type { Dictionary } from '@/i18n/dictionaries';
import { Icon } from '@/components/Icon';

interface OrgRow {
  id: string;
  slug: string;
  displayName: string;
  status: string;
  role: 'OWNER' | 'ADMIN' | 'MEMBER';
}

function roleLabel(role: OrgRow['role'], dict: Dictionary) {
  if (role === 'OWNER') return dict.org.roleOwner;
  if (role === 'ADMIN') return dict.org.roleAdmin;
  return dict.org.roleMember;
}

export function OrganizationsPanel({ locale, dict }: { locale: Locale; dict: Dictionary }) {
  const router = useRouter();
  const [orgs, setOrgs] = useState<OrgRow[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch('/api/orgs', { cache: 'no-store' });
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

  async function create(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const form = new FormData(e.currentTarget);
    const name = String(form.get('name') ?? '').trim();
    const slug = String(form.get('slug') ?? '').trim();
    setCreating(true);
    try {
      const res = await fetch('/api/orgs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(slug ? { name, slug } : { name }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error || dict.common.somethingWrong);
        setCreating(false);
        return;
      }
      const data = await res.json();
      router.push(`/${locale}/app/org/${data.organization.slug}`);
      router.refresh();
    } catch {
      setError(dict.common.somethingWrong);
      setCreating(false);
    }
  }

  return (
    <div className="scroll-slim h-full overflow-y-auto">
      <div className="mx-auto max-w-2xl px-5 py-8">
        <h1 className="text-2xl font-bold tracking-tight text-ink">{dict.org.title}</h1>
        <p className="mt-1 text-sm text-ink-soft">{dict.org.subtitle}</p>

        {error && <p className="mt-4 rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger">{error}</p>}

        <div className="mt-6 space-y-6">
          <section className="card p-5">
            <h2 className="text-sm font-semibold text-ink">{dict.org.members}</h2>
            {loaded && orgs.length === 0 ? (
              <p className="mt-3 text-sm text-ink-soft">{dict.org.noOrgs}</p>
            ) : (
              <ul className="mt-3 divide-y divide-line">
                {orgs.map((o) => (
                  <li key={o.id}>
                    <Link
                      href={`/${locale}/app/org/${o.slug}`}
                      className="flex items-center justify-between gap-3 py-3 transition-colors hover:text-accent"
                    >
                      <span className="flex items-center gap-3">
                        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-accent-soft text-accent">
                          <Icon name="user" width={18} height={18} />
                        </span>
                        <span className="min-w-0">
                          <span className="block truncate text-sm font-medium text-ink">{o.displayName}</span>
                          <span className="block truncate text-xs text-ink-faint">{o.slug}</span>
                        </span>
                      </span>
                      <span className="shrink-0 rounded-full bg-paper-sunken px-2.5 py-1 text-xs font-medium text-ink-soft">
                        {roleLabel(o.role, dict)}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="card p-5">
            <h2 className="text-sm font-semibold text-ink">{dict.org.createTitle}</h2>
            <form onSubmit={create} className="mt-3 max-w-sm space-y-3" noValidate>
              <div>
                <label htmlFor="name" className="mb-1.5 block text-sm text-ink-soft">
                  {dict.org.name}
                </label>
                <input id="name" name="name" className="field" required />
              </div>
              <div>
                <label htmlFor="slug" className="mb-1.5 block text-sm text-ink-soft">
                  {dict.org.slug}
                </label>
                <input id="slug" name="slug" className="field" />
                <p className="mt-1 text-xs text-ink-faint">{dict.org.slugHint}</p>
              </div>
              <button type="submit" className="btn-primary" disabled={creating}>
                {creating ? dict.common.loading : dict.org.create}
              </button>
            </form>
          </section>
        </div>
      </div>
    </div>
  );
}
