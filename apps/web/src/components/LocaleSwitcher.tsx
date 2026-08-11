'use client';

import { usePathname, useRouter } from 'next/navigation';
import { Icon } from './Icon';
import { locales, otherLocale, localeLabel, type Locale } from '@/i18n/config';

/** Toggles between EN and AR, remembers the choice in a cookie, keeps the path. */
export function LocaleSwitcher({ locale, onShell = false }: { locale: Locale; onShell?: boolean }) {
  const pathname = usePathname();
  const router = useRouter();
  const target = otherLocale(locale);

  function switchLocale() {
    document.cookie = `biina_locale=${target}; path=/; max-age=31536000; samesite=lax`;
    const parts = pathname.split('/');
    if ((locales as readonly string[]).includes(parts[1])) {
      parts[1] = target;
    } else {
      parts.splice(1, 0, target);
    }
    router.push(parts.join('/') || `/${target}`);
    router.refresh();
  }

  return (
    <button
      type="button"
      onClick={switchLocale}
      className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm font-medium transition-colors ${
        onShell ? 'text-on-shell-soft hover:bg-shell-raised hover:text-on-shell' : 'text-ink-soft hover:bg-paper-sunken'
      }`}
      aria-label={`Switch language to ${localeLabel[target]}`}
    >
      <Icon name="globe" width={16} height={16} />
      {localeLabel[target]}
    </button>
  );
}
