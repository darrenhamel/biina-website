import { Suspense } from 'react';
import { isLocale, type Locale } from '@/i18n/config';
import { getDictionary } from '@/i18n/dictionaries';
import { ResetPasswordForm } from '@/components/ResetPasswordForm';

export default function ResetPasswordPage({ params }: { params: { locale: string } }) {
  const locale = (isLocale(params.locale) ? params.locale : 'en') as Locale;
  const dict = getDictionary(locale);
  return (
    <Suspense>
      <ResetPasswordForm locale={locale} dict={dict} />
    </Suspense>
  );
}
