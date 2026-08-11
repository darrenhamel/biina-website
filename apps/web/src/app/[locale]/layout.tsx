import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import '@fontsource/manrope/400.css';
import '@fontsource/manrope/500.css';
import '@fontsource/manrope/600.css';
import '@fontsource/manrope/700.css';
import '@fontsource/manrope/800.css';
import '@fontsource/ibm-plex-sans-arabic/400.css';
import '@fontsource/ibm-plex-sans-arabic/500.css';
import '@fontsource/ibm-plex-sans-arabic/600.css';
import '@fontsource/ibm-plex-sans-arabic/700.css';
import '@/styles/globals.css';
import { isLocale, localeDir, locales, type Locale } from '@/i18n/config';

export const metadata: Metadata = {
  title: 'BIINA.ai',
  description: 'An Arabic-first AI platform. BIINA is the product; models are infrastructure.',
};

export function generateStaticParams() {
  return locales.map((locale) => ({ locale }));
}

export default function LocaleLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: { locale: string };
}) {
  if (!isLocale(params.locale)) notFound();
  const locale = params.locale as Locale;
  return (
    <html lang={locale} dir={localeDir[locale]} suppressHydrationWarning>
      <body>{children}</body>
    </html>
  );
}
