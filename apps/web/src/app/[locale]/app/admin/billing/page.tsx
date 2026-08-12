import { redirect } from 'next/navigation';
import { isLocale, type Locale } from '@/i18n/config';
import { getDictionary } from '@/i18n/dictionaries';
import { getCurrentUser } from '@/server/auth/session';
import { isPlatformAdmin } from '@/server/auth/permissions';
import { AdminBillingPanel } from '@/components/app/AdminBillingPanel';

export const dynamic = 'force-dynamic';

export default async function AdminBillingPage({ params }: { params: { locale: string } }) {
  const locale = (isLocale(params.locale) ? params.locale : 'en') as Locale;
  const dict = getDictionary(locale);
  const user = await getCurrentUser();
  if (!user) redirect(`/${locale}/login`);
  if (!isPlatformAdmin(user.role)) redirect(`/${locale}/app`);

  return <AdminBillingPanel locale={locale} dict={dict} />;
}
