import Link from 'next/link';
import { redirect } from 'next/navigation';
import { isLocale, type Locale } from '@/i18n/config';
import { getDictionary } from '@/i18n/dictionaries';
import { getCurrentUser } from '@/server/auth/session';
import { Logo } from '@/components/Logo';
import { LocaleSwitcher } from '@/components/LocaleSwitcher';
import { Icon } from '@/components/Icon';

export const dynamic = 'force-dynamic';

export default async function LandingPage({ params }: { params: { locale: string } }) {
  const locale = (isLocale(params.locale) ? params.locale : 'en') as Locale;
  const t = getDictionary(locale);

  // Signed-in visitors go straight to the product.
  const user = await getCurrentUser().catch(() => null);
  if (user) redirect(`/${locale}/app/chat`);

  const features = [
    { icon: 'spark', title: t.landing.f1Title, body: t.landing.f1Body },
    { icon: 'globe', title: t.landing.f2Title, body: t.landing.f2Body },
    { icon: 'shield', title: t.landing.f3Title, body: t.landing.f3Body },
  ];

  return (
    <div className="min-h-dvh bg-paper">
      <header className="mx-auto flex max-w-6xl items-center justify-between px-5 py-5">
        <Logo />
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
        <section className="py-16 md:py-24">
          <span className="inline-flex items-center gap-2 rounded-full border border-line bg-paper-raised px-3 py-1 text-xs font-medium text-ink-soft">
            <span className="h-1.5 w-1.5 rounded-full bg-gold" />
            {t.landing.devNotice}
          </span>
          <h1 className="mt-6 max-w-3xl text-4xl font-extrabold leading-[1.1] tracking-tight text-ink md:text-6xl">
            {t.landing.heroTitle}
          </h1>
          <p className="mt-6 max-w-2xl text-lg leading-relaxed text-ink-soft">
            {t.landing.heroSubtitle}
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link href={`/${locale}/signup`} className="btn-primary px-6 py-3 text-base">
              {t.landing.ctaPrimary}
              <Icon name="send" width={18} height={18} />
            </Link>
            <Link href={`/${locale}/login`} className="btn-outline px-6 py-3 text-base">
              {t.landing.ctaSecondary}
            </Link>
          </div>
        </section>

        <section className="grid gap-4 pb-24 md:grid-cols-3">
          {features.map((f) => (
            <div key={f.title} className="card p-6">
              <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-accent-soft text-accent">
                <Icon name={f.icon} />
              </div>
              <h3 className="mt-4 text-lg font-semibold text-ink">{f.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-ink-soft">{f.body}</p>
            </div>
          ))}
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
