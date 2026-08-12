'use client';

import { useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import type { Locale } from '@/i18n/config';
import type { Dictionary } from '@/i18n/dictionaries';
import { primaryNav } from '@/config/navigation';
import { Logo } from '@/components/Logo';
import { LocaleSwitcher } from '@/components/LocaleSwitcher';
import { Icon } from '@/components/Icon';

export interface ShellUser {
  displayName: string;
  email: string;
  role: 'USER' | 'ADMIN' | 'SUPER_ADMIN';
}
export interface ConversationLite {
  id: string;
  title: string;
}

export interface WorkspaceLite {
  slug: string;
  displayName: string;
}

export function AppShell({
  locale,
  dict,
  user,
  conversations,
  organizations = [],
  activeWorkspace = 'personal',
  children,
}: {
  locale: Locale;
  dict: Dictionary;
  user: ShellUser;
  conversations: ConversationLite[];
  organizations?: WorkspaceLite[];
  activeWorkspace?: string;
  children: React.ReactNode;
}) {
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <div className="flex h-dvh overflow-hidden bg-paper">
      {/* Sidebar */}
      <Sidebar
        locale={locale}
        dict={dict}
        user={user}
        conversations={conversations}
        mobileOpen={mobileOpen}
        onNavigate={() => setMobileOpen(false)}
      />

      {/* Mobile scrim */}
      {mobileOpen && (
        <button
          aria-label="Close menu"
          onClick={() => setMobileOpen(false)}
          className="fixed inset-0 z-30 bg-black/40 md:hidden"
        />
      )}

      {/* Main column */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 shrink-0 items-center justify-between border-b border-line px-4 md:px-6">
          <button
            type="button"
            className="btn-ghost -ms-2 p-2 md:hidden"
            aria-label="Open menu"
            onClick={() => setMobileOpen(true)}
          >
            <Icon name="menu" />
          </button>
          <div className="md:hidden">
            <Logo />
          </div>
          <div className="ms-auto flex items-center gap-1.5">
            <WorkspaceSwitcher
              locale={locale}
              dict={dict}
              organizations={organizations}
              activeWorkspace={activeWorkspace}
            />
            <LocaleSwitcher locale={locale} />
            <AccountMenu locale={locale} dict={dict} user={user} />
          </div>
        </header>

        <main className="min-h-0 flex-1 overflow-hidden">{children}</main>
      </div>
    </div>
  );
}

function Sidebar({
  locale,
  dict,
  user,
  conversations,
  mobileOpen,
  onNavigate,
}: {
  locale: Locale;
  dict: Dictionary;
  user: ShellUser;
  conversations: ConversationLite[];
  mobileOpen: boolean;
  onNavigate: () => void;
}) {
  const pathname = usePathname();
  const base = `/${locale}/app`;

  return (
    <aside
      className={`fixed inset-y-0 z-40 flex w-72 flex-col bg-shell text-on-shell transition-transform duration-200 md:static md:translate-x-0 ${
        mobileOpen ? 'translate-x-0' : 'ltr:-translate-x-full rtl:translate-x-full'
      }`}
    >
      <div className="flex h-14 items-center px-4">
        <Link href={`/${locale}/app/chat`} onClick={onNavigate}>
          <Logo onDark />
        </Link>
      </div>

      <div className="px-3">
        <Link
          href={`/${locale}/app/chat`}
          onClick={onNavigate}
          className="btn w-full justify-start gap-2 border border-white/10 bg-shell-raised text-on-shell hover:bg-white/10"
        >
          <Icon name="plus" width={18} height={18} />
          {dict.chat.newChat}
        </Link>
      </div>

      {/* Primary nav */}
      <nav className="mt-4 px-3">
        <ul className="space-y-0.5">
          {primaryNav.map((item) => {
            const href = `${base}/${item.path}`;
            const active = pathname.startsWith(href);
            const label = dict.nav[item.labelKey];
            if (!item.enabled) {
              return (
                <li key={item.key}>
                  <span
                    className="flex cursor-not-allowed items-center gap-3 rounded-lg px-3 py-2 text-sm text-on-shell-soft/60"
                    title={dict.common.comingSoon}
                  >
                    <Icon name={item.icon} width={18} height={18} />
                    <span className="flex-1">{label}</span>
                    <span className="rounded bg-white/5 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-on-shell-soft/70">
                      {dict.common.comingSoon}
                    </span>
                  </span>
                </li>
              );
            }
            return (
              <li key={item.key}>
                <Link
                  href={href}
                  onClick={onNavigate}
                  className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors ${
                    active ? 'bg-white/10 text-on-shell' : 'text-on-shell-soft hover:bg-white/5 hover:text-on-shell'
                  }`}
                >
                  <Icon name={item.icon} width={18} height={18} />
                  {label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      {/* Conversations */}
      <div className="mt-4 flex min-h-0 flex-1 flex-col px-3">
        <p className="px-3 pb-1.5 text-xs font-semibold uppercase tracking-wide text-on-shell-soft/70">
          {dict.chat.conversations}
        </p>
        <ul className="scroll-slim min-h-0 flex-1 space-y-0.5 overflow-y-auto pb-2">
          {conversations.length === 0 && (
            <li className="px-3 py-2 text-sm text-on-shell-soft/60">{dict.chat.noConversations}</li>
          )}
          {conversations.map((c) => {
            const href = `${base}/chat/${c.id}`;
            const active = pathname === href;
            return (
              <li key={c.id}>
                <Link
                  href={href}
                  onClick={onNavigate}
                  className={`block truncate rounded-lg px-3 py-2 text-sm transition-colors ${
                    active ? 'bg-white/10 text-on-shell' : 'text-on-shell-soft hover:bg-white/5 hover:text-on-shell'
                  }`}
                >
                  {c.title}
                </Link>
              </li>
            );
          })}
        </ul>
      </div>

      <div className="border-t border-white/10 p-3">
        <Link
          href={`${base}/settings`}
          onClick={onNavigate}
          className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm text-on-shell-soft hover:bg-white/5 hover:text-on-shell"
        >
          <Icon name="settings" width={18} height={18} />
          {dict.nav.settings}
        </Link>
        <div className="flex items-center gap-2 px-3 pt-2 text-xs text-on-shell-soft/70">
          <span className="grid h-7 w-7 place-items-center rounded-full bg-accent text-on-accent">
            {user.displayName.charAt(0).toUpperCase()}
          </span>
          <span className="truncate">{user.displayName}</span>
        </div>
      </div>
    </aside>
  );
}

function AccountMenu({
  locale,
  dict,
  user,
}: {
  locale: Locale;
  dict: Dictionary;
  user: ShellUser;
}) {
  const [open, setOpen] = useState(false);
  const router = useRouter();

  async function signOut() {
    await fetch('/api/auth/logout', { method: 'POST' });
    router.push(`/${locale}`);
    router.refresh();
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="btn-ghost gap-2 p-1.5"
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <span className="grid h-7 w-7 place-items-center rounded-full bg-accent text-sm font-semibold text-on-accent">
          {user.displayName.charAt(0).toUpperCase()}
        </span>
      </button>
      {open && (
        <>
          <button className="fixed inset-0 z-10" aria-hidden onClick={() => setOpen(false)} />
          <div
            role="menu"
            className="absolute end-0 z-20 mt-1 w-52 overflow-hidden rounded-xl border border-line bg-paper-raised py-1 shadow-lg"
          >
            <div className="border-b border-line px-3 py-2">
              <p className="truncate text-sm font-medium text-ink">{user.displayName}</p>
              <p className="truncate text-xs text-ink-faint">{user.email}</p>
            </div>
            <MenuLink href={`/${locale}/app/account`} icon="user" label={dict.nav.account} onClick={() => setOpen(false)} />
            <MenuLink href={`/${locale}/app/organizations`} icon="user" label={dict.nav.organizations} onClick={() => setOpen(false)} />
            <MenuLink href={`/${locale}/app/security`} icon="shield" label={dict.nav.security} onClick={() => setOpen(false)} />
            <MenuLink href={`/${locale}/app/settings/personalization`} icon="spark" label={dict.personalization.title} onClick={() => setOpen(false)} />
            <MenuLink href={`/${locale}/app/settings/connections`} icon="spark" label={dict.connectors.title} onClick={() => setOpen(false)} />
            <MenuLink href={`/${locale}/app/settings/voice-media`} icon="volume" label={dict.voiceMedia.title} onClick={() => setOpen(false)} />
            <MenuLink href={`/${locale}/app/usage`} icon="spark" label={dict.nav.usage} onClick={() => setOpen(false)} />
            <MenuLink href={`/${locale}/app/settings/billing`} icon="spark" label={dict.nav.billing} onClick={() => setOpen(false)} />
            <MenuLink href={`/${locale}/app/settings`} icon="settings" label={dict.nav.settings} onClick={() => setOpen(false)} />
            {(user.role === 'ADMIN' || user.role === 'SUPER_ADMIN') && (
              <MenuLink href={`/${locale}/app/admin`} icon="shield" label={dict.nav.admin} onClick={() => setOpen(false)} />
            )}
            <button
              type="button"
              role="menuitem"
              onClick={signOut}
              className="flex w-full items-center gap-2.5 px-3 py-2 text-sm text-ink hover:bg-paper-sunken"
            >
              <Icon name="logout" width={16} height={16} />
              {dict.common.signOut}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function WorkspaceSwitcher({
  locale,
  dict,
  organizations,
  activeWorkspace,
}: {
  locale: Locale;
  dict: Dictionary;
  organizations: WorkspaceLite[];
  activeWorkspace: string;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const router = useRouter();

  if (organizations.length === 0) return null;

  const active = organizations.find((o) => o.slug === activeWorkspace);
  const activeLabel = active ? active.displayName : dict.org.personal;

  async function select(workspace: string) {
    setOpen(false);
    if (workspace === activeWorkspace) return;
    setBusy(true);
    try {
      await fetch('/api/workspace', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workspace }),
      });
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  const options: WorkspaceLite[] = [{ slug: 'personal', displayName: dict.org.personal }, ...organizations];

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="btn-ghost max-w-[10rem] gap-2 px-2.5 py-1.5 text-sm"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={dict.org.switchWorkspace}
        disabled={busy}
      >
        <Icon name="user" width={16} height={16} />
        <span className="truncate">{activeLabel}</span>
      </button>
      {open && (
        <>
          <button className="fixed inset-0 z-10" aria-hidden onClick={() => setOpen(false)} />
          <div
            role="menu"
            className="absolute end-0 z-20 mt-1 w-56 overflow-hidden rounded-xl border border-line bg-paper-raised py-1 shadow-lg"
          >
            <p className="px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-ink-faint">
              {dict.org.workspace}
            </p>
            {options.map((o) => {
              const isActive = o.slug === activeWorkspace;
              return (
                <button
                  key={o.slug}
                  type="button"
                  role="menuitem"
                  onClick={() => select(o.slug)}
                  className={`flex w-full items-center gap-2 px-3 py-2 text-sm hover:bg-paper-sunken ${
                    isActive ? 'font-semibold text-accent' : 'text-ink'
                  }`}
                >
                  <span
                    className={`h-1.5 w-1.5 shrink-0 rounded-full ${isActive ? 'bg-accent' : 'bg-transparent'}`}
                  />
                  <span className="truncate">{o.displayName}</span>
                </button>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

function MenuLink({
  href,
  icon,
  label,
  onClick,
}: {
  href: string;
  icon: string;
  label: string;
  onClick: () => void;
}) {
  return (
    <Link
      href={href}
      role="menuitem"
      onClick={onClick}
      className="flex items-center gap-2.5 px-3 py-2 text-sm text-ink hover:bg-paper-sunken"
    >
      <Icon name={icon} width={16} height={16} />
      {label}
    </Link>
  );
}
