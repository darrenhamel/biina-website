'use client';

import { useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import type { Locale } from '@/i18n/config';
import type { Dictionary } from '@/i18n/dictionaries';
import { Logo } from './Logo';
import { LocaleSwitcher } from './LocaleSwitcher';

export function ResetPasswordForm({ locale, dict }: { locale: Locale; dict: Dictionary }) {
  const search = useSearchParams();
  const token = search.get('token') ?? '';
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const form = new FormData(e.currentTarget);
    const newPassword = String(form.get('newPassword') ?? '');
    const confirmPassword = String(form.get('confirmPassword') ?? '');
    if (newPassword !== confirmPassword) {
      setError(dict.security.passwordMismatch);
      return;
    }
    setLoading(true);
    try {
      const res = await fetch('/api/auth/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, newPassword }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error || dict.common.somethingWrong);
        setLoading(false);
        return;
      }
      setDone(true);
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
          <h1 className="text-2xl font-bold tracking-tight text-ink">{dict.security.newPassword}</h1>
          <p className="mt-1.5 text-sm text-ink-soft">{dict.security.subtitle}</p>

          {done ? (
            <div className="mt-6 space-y-4">
              <p className="rounded-lg bg-paper-sunken px-3 py-2 text-sm text-ink-soft">
                {dict.security.passwordChanged}
              </p>
              <Link href={`/${locale}/login`} className="btn-primary w-full justify-center py-2.5">
                {dict.common.signIn}
              </Link>
            </div>
          ) : (
            <form onSubmit={onSubmit} className="mt-6 space-y-4" noValidate>
              <div>
                <label htmlFor="newPassword" className="mb-1.5 block text-sm font-medium text-ink">
                  {dict.security.newPassword}
                </label>
                <input
                  id="newPassword"
                  name="newPassword"
                  type="password"
                  className="field"
                  autoComplete="new-password"
                  required
                />
              </div>
              <div>
                <label htmlFor="confirmPassword" className="mb-1.5 block text-sm font-medium text-ink">
                  {dict.security.confirmPassword}
                </label>
                <input
                  id="confirmPassword"
                  name="confirmPassword"
                  type="password"
                  className="field"
                  autoComplete="new-password"
                  required
                />
              </div>

              {error && (
                <p role="alert" className="rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger">
                  {error}
                </p>
              )}

              <button type="submit" className="btn-primary w-full py-3" disabled={loading}>
                {loading ? dict.common.loading : dict.common.save}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
