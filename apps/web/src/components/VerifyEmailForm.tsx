'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import type { Locale } from '@/i18n/config';
import type { Dictionary } from '@/i18n/dictionaries';
import { Logo } from './Logo';
import { LocaleSwitcher } from './LocaleSwitcher';

type State = 'verifying' | 'verified' | 'invalid';

export function VerifyEmailForm({ locale, dict }: { locale: Locale; dict: Dictionary }) {
  const search = useSearchParams();
  const token = search.get('token') ?? '';
  const [state, setState] = useState<State>('verifying');
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;
    if (!token) {
      setState('invalid');
      return;
    }
    fetch('/api/auth/verify-email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
    })
      .then((res) => setState(res.ok ? 'verified' : 'invalid'))
      .catch(() => setState('invalid'));
  }, [token]);

  return (
    <div className="grid min-h-dvh place-items-center bg-paper px-5 py-10">
      <div className="w-full max-w-md">
        <div className="mb-6 flex items-center justify-between">
          <Link href={`/${locale}`} aria-label="BIINA home">
            <Logo />
          </Link>
          <LocaleSwitcher locale={locale} />
        </div>

        <div className="card p-7 text-center animate-fade-in">
          <h1 className="text-2xl font-bold tracking-tight text-ink">{dict.security.emailVerification}</h1>

          {state === 'verifying' && (
            <div className="mt-8 grid place-items-center gap-4">
              <span className="h-6 w-6 animate-spin rounded-full border-2 border-line-strong border-t-accent" />
              <p className="text-sm text-ink-soft">{dict.common.loading}</p>
            </div>
          )}

          {state === 'verified' && (
            <div className="mt-6 space-y-4">
              <p className="rounded-lg bg-paper-sunken px-3 py-2 text-sm text-ink-soft">{dict.security.verified}</p>
              <Link href={`/${locale}/app/chat`} className="btn-primary w-full justify-center py-2.5">
                {dict.nav.chat}
              </Link>
            </div>
          )}

          {state === 'invalid' && (
            <div className="mt-6 space-y-4">
              <p className="rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger">{dict.security.unverified}</p>
              <Link href={`/${locale}/app/chat`} className="btn w-full justify-center py-2.5">
                {dict.nav.chat}
              </Link>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
