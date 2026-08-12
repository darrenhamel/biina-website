'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import type { Locale } from '@/i18n/config';
import type { Dictionary } from '@/i18n/dictionaries';
import { Logo } from './Logo';
import { LocaleSwitcher } from './LocaleSwitcher';

type State =
  | { kind: 'idle' }
  | { kind: 'needsSignIn' }
  | { kind: 'accepted'; slug?: string }
  | { kind: 'error'; message: string };

export function AcceptInviteForm({ locale, dict }: { locale: Locale; dict: Dictionary }) {
  const search = useSearchParams();
  const token = search.get('token') ?? '';
  const [loading, setLoading] = useState(false);
  const [state, setState] = useState<State>({ kind: 'idle' });

  async function accept() {
    setLoading(true);
    setState({ kind: 'idle' });
    try {
      const res = await fetch('/api/orgs/accept', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
      });
      if (res.status === 401) {
        setState({ kind: 'needsSignIn' });
        setLoading(false);
        return;
      }
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setState({ kind: 'error', message: data.error || dict.invite.invalid });
        setLoading(false);
        return;
      }
      const data = await res.json().catch(() => ({}));
      setState({ kind: 'accepted', slug: data.slug });
      setLoading(false);
    } catch {
      setState({ kind: 'error', message: dict.common.somethingWrong });
      setLoading(false);
    }
  }

  const nextParam = encodeURIComponent(`/${locale}/invite?token=${token}`);

  return (
    <div className="grid min-h-dvh place-items-center bg-paper px-5 py-10">
      <div className="w-full max-w-md">
        <div className="mb-6 flex items-center justify-between">
          <Link href={`/${locale}`} aria-label="BIINA home">
            <Logo />
          </Link>
          <LocaleSwitcher locale={locale} />
        </div>

        <div className="card p-7 animate-fade-in">
          <h1 className="text-2xl font-bold tracking-tight text-ink">{dict.invite.title}</h1>
          <p className="mt-1.5 text-sm text-ink-soft">{dict.invite.subtitle}</p>

          {!token ? (
            <p className="mt-6 rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger">{dict.invite.missingToken}</p>
          ) : state.kind === 'accepted' ? (
            <div className="mt-6 space-y-4">
              <p className="rounded-lg bg-paper-sunken px-3 py-2 text-sm text-ink-soft">{dict.invite.accepted}</p>
              <Link
                href={state.slug ? `/${locale}/app/org/${state.slug}` : `/${locale}/app/organizations`}
                className="btn-primary w-full justify-center py-2.5"
              >
                {dict.nav.organizations}
              </Link>
            </div>
          ) : state.kind === 'needsSignIn' ? (
            <div className="mt-6 space-y-4">
              <p className="rounded-lg bg-paper-sunken px-3 py-2 text-sm text-ink-soft">{dict.invite.signInToAccept}</p>
              <Link href={`/${locale}/login?next=${nextParam}`} className="btn-primary w-full justify-center py-2.5">
                {dict.common.signIn}
              </Link>
            </div>
          ) : (
            <div className="mt-6 space-y-4">
              {state.kind === 'error' && (
                <p role="alert" className="rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger">
                  {state.message}
                </p>
              )}
              <button onClick={accept} className="btn-primary w-full py-3" disabled={loading}>
                {loading ? dict.invite.accepting : dict.invite.accept}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
