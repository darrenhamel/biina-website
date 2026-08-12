import { redirect } from 'next/navigation';
import { isLocale, type Locale } from '@/i18n/config';
import { getDictionary } from '@/i18n/dictionaries';
import { getCurrentUser } from '@/server/auth/session';
import { isPlatformAdmin } from '@/server/auth/permissions';
import { AdminOrgsPanel } from '@/components/app/AdminOrgsPanel';

export const dynamic = 'force-dynamic';

export default async function AdminOrgsPage({ params }: { params: { locale: string } }) {
  const locale = (isLocale(params.locale) ? params.locale : 'en') as Locale;
  const dict = getDictionary(locale);
  const user = await getCurrentUser();
  if (!user) redirect(`/${locale}/login`);
  if (!isPlatformAdmin(user.role)) redirect(`/${locale}/app`);

  return <AdminOrgsPanel locale={locale} dict={dict} />;
}
