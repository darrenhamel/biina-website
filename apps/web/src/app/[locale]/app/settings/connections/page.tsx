import { redirect } from 'next/navigation';
import { isLocale, type Locale } from '@/i18n/config';
import { getDictionary } from '@/i18n/dictionaries';
import { getCurrentUser } from '@/server/auth/session';
import { ConnectionsPanel } from '@/components/app/ConnectionsPanel';

export const dynamic = 'force-dynamic';

export default async function ConnectionsPage({ params }: { params: { locale: string } }) {
  const locale = (isLocale(params.locale) ? params.locale : 'en') as Locale;
  const dict = getDictionary(locale);
  const user = await getCurrentUser();
  if (!user) redirect(`/${locale}/login`);

  return <ConnectionsPanel locale={locale} dict={dict} />;
}
