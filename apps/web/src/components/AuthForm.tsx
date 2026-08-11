'use client';

import { useState, type FormEvent } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import type { Locale } from '@/i18n/config';
import type { Dictionary } from '@/i18n/dictionaries';
import { Logo } from './Logo';
import { LocaleSwitcher } from './LocaleSwitcher';

export function AuthForm({
  mode,
  locale,
  dict,
}: {
  mode: 'login' | 'signup';
  locale: Locale;
  dict: Dictionary;
}) {
  const router = useRouter();
  const search = useSearchParams();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isSignup = mode === 'signup';
  const t = dict;

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    const form = new FormData(e.currentTarget);
    const payload = Object.fromEntries(form.entries());

    try {
      const res = await fetch(`/api/auth/${mode}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error || t.common.somethingWrong);
        setLoading(false);
        return;
      }
      const next = search.get('next') || `/${locale}/app/chat`;
      router.push(next);
      router.refresh();
    } catch {
      setError(t.common.somethingWrong);
      setLoading(false);
    }
  }

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
          <h1 className="text-2xl font-bold tracking-tight text-ink">
            {isSignup ? t.auth.signupTitle : t.auth.loginTitle}
          </h1>
          <p className="mt-1.5 text-sm text-ink-soft">
            {isSignup ? t.auth.signupSubtitle : t.auth.loginSubtitle}
          </p>

          <form onSubmit={onSubmit} className="mt-6 space-y-4" noValidate>
            {isSignup && (
              <Field id="displayName" label={t.common.displayName} autoComplete="name" required />
            )}
            <Field id="email" type="email" label={t.common.email} autoComplete="email" required />
            <Field
              id="password"
              type="password"
              label={t.common.password}
              autoComplete={isSignup ? 'new-password' : 'current-password'}
              hint={isSignup ? t.auth.passwordHint : undefined}
              required
            />

            {error && (
              <p role="alert" className="rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger">
                {error}
              </p>
            )}

            <button type="submit" className="btn-primary w-full py-3" disabled={loading}>
              {loading ? t.common.loading : isSignup ? t.auth.createAccount : t.common.signIn}
            </button>
          </form>

          <p className="mt-5 text-center text-sm text-ink-soft">
            {isSignup ? t.auth.haveAccount : t.auth.noAccount}{' '}
            <Link
              href={`/${locale}/${isSignup ? 'login' : 'signup'}`}
              className="font-semibold text-accent hover:underline"
            >
              {isSignup ? t.common.signIn : t.common.signUp}
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}

function Field({
  id,
  label,
  type = 'text',
  hint,
  ...rest
}: {
  id: string;
  label: string;
  type?: string;
  hint?: string;
} & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <div>
      <label htmlFor={id} className="mb-1.5 block text-sm font-medium text-ink">
        {label}
      </label>
      <input id={id} name={id} type={type} className="field" {...rest} />
      {hint && <p className="mt-1 text-xs text-ink-faint">{hint}</p>}
    </div>
  );
}
