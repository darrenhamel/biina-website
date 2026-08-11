import { Suspense } from 'react';
import { isLocale, type Locale } from '@/i18n/config';
import { getDictionary } from '@/i18n/dictionaries';
import { AuthForm } from '@/components/AuthForm';

export default function LoginPage({ params }: { params: { locale: string } }) {
  const locale = (isLocale(params.locale) ? params.locale : 'en') as Locale;
  const dict = getDictionary(locale);
  return (
    <Suspense>
      <AuthForm mode="login" locale={locale} dict={dict} />
    </Suspense>
  );
}
