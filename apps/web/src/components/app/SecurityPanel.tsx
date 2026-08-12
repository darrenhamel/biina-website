'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import type { Locale } from '@/i18n/config';
import type { Dictionary } from '@/i18n/dictionaries';

interface SessionRow {
  id: string;
  current: boolean;
  createdAt: string;
  lastUsedAt: string | null;
  userAgent: string | null;
}

export function SecurityPanel({
  locale,
  dict,
  initialEmailVerified,
}: {
  locale: Locale;
  dict: Dictionary;
  initialEmailVerified: boolean;
}) {
  return (
    <div className="scroll-slim h-full overflow-y-auto">
      <div className="mx-auto max-w-2xl px-5 py-8">
        <h1 className="text-2xl font-bold tracking-tight text-ink">{dict.security.title}</h1>
        <p className="mt-1 text-sm text-ink-soft">{dict.security.subtitle}</p>

        <div className="mt-6 space-y-6">
          <ChangePasswordCard dict={dict} />
          <SessionsCard locale={locale} dict={dict} />
          <EmailVerificationCard dict={dict} initialEmailVerified={initialEmailVerified} />
        </div>
      </div>
    </div>
  );
}

function ChangePasswordCard({ dict }: { dict: Dictionary }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState(false);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setOk(false);
    const formEl = e.currentTarget;
    const form = new FormData(formEl);
    const currentPassword = String(form.get('currentPassword') ?? '');
    const newPassword = String(form.get('newPassword') ?? '');
    const confirmPassword = String(form.get('confirmPassword') ?? '');
    if (newPassword !== confirmPassword) {
      setError(dict.security.passwordMismatch);
      return;
    }
    setLoading(true);
    try {
      const res = await fetch('/api/auth/change-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error || dict.common.somethingWrong);
        setLoading(false);
        return;
      }
      setOk(true);
      formEl.reset();
      setLoading(false);
    } catch {
      setError(dict.common.somethingWrong);
      setLoading(false);
    }
  }

  return (
    <section className="card p-5">
      <h2 className="text-sm font-semibold text-ink">{dict.security.changePassword}</h2>
      <form onSubmit={onSubmit} className="mt-3 max-w-sm space-y-3" noValidate>
        <div>
          <label htmlFor="currentPassword" className="mb-1.5 block text-sm text-ink-soft">
            {dict.security.currentPassword}
          </label>
          <input
            id="currentPassword"
            name="currentPassword"
            type="password"
            className="field"
            autoComplete="current-password"
            required
          />
        </div>
        <div>
          <label htmlFor="newPassword" className="mb-1.5 block text-sm text-ink-soft">
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
          <label htmlFor="confirmPassword" className="mb-1.5 block text-sm text-ink-soft">
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
        {ok && (
          <p role="status" className="rounded-lg bg-paper-sunken px-3 py-2 text-sm text-ink-soft">
            {dict.security.passwordChanged}
          </p>
        )}

        <button type="submit" className="btn-primary" disabled={loading}>
          {loading ? dict.common.loading : dict.common.save}
        </button>
      </form>
    </section>
  );
}

function SessionsCard({ locale, dict }: { locale: Locale; dict: Dictionary }) {
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch('/api/auth/sessions', { cache: 'no-store' });
      if (!res.ok) throw new Error();
      const data = await res.json();
      setSessions(data.sessions ?? []);
    } catch {
      setError(dict.common.somethingWrong);
    }
  }, [dict]);

  useEffect(() => {
    void load();
  }, [load]);

  const fmt = new Intl.DateTimeFormat(locale === 'ar' ? 'ar-AE' : 'en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
  });

  async function revoke(id: string) {
    setBusy(true);
    try {
      await fetch(`/api/auth/sessions/${id}`, { method: 'DELETE' });
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function revokeOthers() {
    setBusy(true);
    try {
      await fetch('/api/auth/sessions/revoke-others', { method: 'POST' });
      await load();
    } finally {
      setBusy(false);
    }
  }

  const hasOthers = sessions.some((s) => !s.current);

  return (
    <section className="card p-5">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold text-ink">{dict.security.sessions}</h2>
          <p className="mt-0.5 text-sm text-ink-soft">{dict.security.sessionsSub}</p>
        </div>
        {hasOthers && (
          <button onClick={revokeOthers} className="btn" disabled={busy}>
            {dict.security.revokeOthers}
          </button>
        )}
      </div>

      {error && <p className="mt-3 rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger">{error}</p>}

      <ul className="mt-3 divide-y divide-line">
        {sessions.map((s) => (
          <li key={s.id} className="flex items-center justify-between gap-3 py-3">
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-ink">{s.userAgent || dict.security.unknownDevice}</p>
              <p className="mt-0.5 text-xs text-ink-faint">
                {dict.security.lastActive}: {fmt.format(new Date(s.lastUsedAt ?? s.createdAt))}
              </p>
            </div>
            {s.current ? (
              <span className="shrink-0 rounded-full bg-accent-soft px-2.5 py-1 text-xs font-medium text-accent">
                {dict.security.thisDevice}
              </span>
            ) : (
              <button onClick={() => revoke(s.id)} className="btn-ghost shrink-0 text-danger" disabled={busy}>
                {dict.security.revoke}
              </button>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

function EmailVerificationCard({
  dict,
  initialEmailVerified,
}: {
  dict: Dictionary;
  initialEmailVerified: boolean;
}) {
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [devLink, setDevLink] = useState<string | null>(null);
  const [verified, setVerified] = useState(initialEmailVerified);

  async function resend() {
    setLoading(true);
    try {
      const res = await fetch('/api/auth/resend-verification', { method: 'POST' });
      const data = await res.json().catch(() => ({}));
      if (data.alreadyVerified) setVerified(true);
      setDevLink(data.devVerifyLink ?? null);
      setSent(true);
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="card p-5">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-ink">{dict.security.emailVerification}</h2>
        <span
          className={`rounded-full px-2.5 py-1 text-xs font-medium ${
            verified ? 'bg-accent-soft text-accent' : 'bg-danger/10 text-danger'
          }`}
        >
          {verified ? dict.security.verified : dict.security.unverified}
        </span>
      </div>

      {!verified && (
        <div className="mt-3 space-y-3">
          <button onClick={resend} className="btn" disabled={loading}>
            {loading ? dict.common.loading : dict.security.resendVerification}
          </button>
          {sent && (
            <p role="status" className="rounded-lg bg-paper-sunken px-3 py-2 text-sm text-ink-soft">
              {dict.security.verificationSent}
            </p>
          )}
          {devLink && (
            <a href={devLink} className="block break-all text-sm font-semibold text-accent hover:underline">
              {devLink}
            </a>
          )}
        </div>
      )}
    </section>
  );
}
