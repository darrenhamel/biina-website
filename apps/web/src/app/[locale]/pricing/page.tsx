import Link from 'next/link';
import { isLocale, type Locale } from '@/i18n/config';
import { getDictionary } from '@/i18n/dictionaries';
import { Logo } from '@/components/Logo';
import { LocaleSwitcher } from '@/components/LocaleSwitcher';
import { PricingTable } from '@/components/PricingTable';

export const dynamic = 'force-dynamic';

export default async function PricingPage({ params }: { params: { locale: string } }) {
  const locale = (isLocale(params.locale) ? params.locale : 'en') as Locale;
  const t = getDictionary(locale);

  return (
    <div className="min-h-dvh bg-paper">
      <header className="mx-auto flex max-w-6xl items-center justify-between px-5 py-5">
        <Link href={`/${locale}`} aria-label="BIINA home">
          <Logo />
        </Link>
        <div className="flex items-center gap-1.5">
          <LocaleSwitcher locale={locale} />
          <Link href={`/${locale}/login`} className="btn-ghost">
            {t.common.signIn}
          </Link>
          <Link href={`/${locale}/signup`} className="btn-primary">
            {t.common.signUp}
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-5">
        <section className="py-12 md:py-16">
          <h1 className="text-3xl font-extrabold tracking-tight text-ink md:text-4xl">
            {t.pricing.title}
          </h1>
          <p className="mt-3 max-w-2xl text-lg leading-relaxed text-ink-soft">
            {t.pricing.subtitle}
          </p>

          <div className="mt-10">
            <PricingTable locale={locale} dict={t} />
          </div>
        </section>
      </main>

      <footer className="border-t border-line">
        <div className="mx-auto flex max-w-6xl flex-col items-start justify-between gap-3 px-5 py-8 text-sm text-ink-faint sm:flex-row sm:items-center">
          <Logo />
          <p>© {new Date().getFullYear()} BIINA — {t.common.tagline}</p>
        </div>
      </footer>
    </div>
  );
}
