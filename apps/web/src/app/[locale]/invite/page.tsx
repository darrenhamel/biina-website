import { Suspense } from 'react';
import { isLocale, type Locale } from '@/i18n/config';
import { getDictionary } from '@/i18n/dictionaries';
import { AcceptInviteForm } from '@/components/AcceptInviteForm';

export default function InvitePage({ params }: { params: { locale: string } }) {
  const locale = (isLocale(params.locale) ? params.locale : 'en') as Locale;
  const dict = getDictionary(locale);
  return (
    <Suspense>
      <AcceptInviteForm locale={locale} dict={dict} />
    </Suspense>
  );
}
