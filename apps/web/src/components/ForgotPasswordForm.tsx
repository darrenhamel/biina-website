'use client';

import { useState, type FormEvent } from 'react';
import Link from 'next/link';
import type { Locale } from '@/i18n/config';
import type { Dictionary } from '@/i18n/dictionaries';
import { Logo } from './Logo';
import { LocaleSwitcher } from './LocaleSwitcher';

export function ForgotPasswordForm({ locale, dict }: { locale: Locale; dict: Dictionary }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [devLink, setDevLink] = useState<string | null>(null);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    const form = new FormData(e.currentTarget);
    try {
      const res = await fetch('/api/auth/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: form.get('email') }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error || dict.common.somethingWrong);
        setLoading(false);
        return;
      }
      const data = await res.json().catch(() => ({}));
      setDevLink(data.devResetLink ?? null);
      setSent(true);
      setLoading(false);
    } catch {
      setError(dict.common.somethingWrong);
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
          <h1 className="text-2xl font-bold tracking-tight text-ink">{dict.security.changePassword}</h1>
          <p className="mt-1.5 text-sm text-ink-soft">{dict.security.subtitle}</p>

          {sent ? (
            <div className="mt-6 space-y-4">
              <p className="rounded-lg bg-paper-sunken px-3 py-2 text-sm text-ink-soft">
                {dict.security.verificationSent}
              </p>
              {devLink && (
                <Link href={devLink} className="block break-all text-sm font-semibold text-accent hover:underline">
                  {devLink}
                </Link>
              )}
              <Link href={`/${locale}/login`} className="btn w-full justify-center py-2.5">
                {dict.common.signIn}
              </Link>
            </div>
          ) : (
            <form onSubmit={onSubmit} className="mt-6 space-y-4" noValidate>
              <div>
                <label htmlFor="email" className="mb-1.5 block text-sm font-medium text-ink">
                  {dict.common.email}
                </label>
                <input id="email" name="email" type="email" className="field" autoComplete="email" required />
              </div>

              {error && (
                <p role="alert" className="rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger">
                  {error}
                </p>
              )}

              <button type="submit" className="btn-primary w-full py-3" disabled={loading}>
                {loading ? dict.common.loading : dict.chat.send}
              </button>
            </form>
          )}

          <p className="mt-5 text-center text-sm text-ink-soft">
            <Link href={`/${locale}/login`} className="font-semibold text-accent hover:underline">
              {dict.common.signIn}
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
