import { Suspense } from 'react';
import { isLocale, type Locale } from '@/i18n/config';
import { getDictionary } from '@/i18n/dictionaries';
import { VerifyEmailForm } from '@/components/VerifyEmailForm';

export default function VerifyEmailPage({ params }: { params: { locale: string } }) {
  const locale = (isLocale(params.locale) ? params.locale : 'en') as Locale;
  const dict = getDictionary(locale);
  return (
    <Suspense>
      <VerifyEmailForm locale={locale} dict={dict} />
    </Suspense>
  );
}
