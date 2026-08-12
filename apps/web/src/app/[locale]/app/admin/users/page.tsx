import { redirect } from 'next/navigation';
import { isLocale, type Locale } from '@/i18n/config';
import { getDictionary } from '@/i18n/dictionaries';
import { getCurrentUser } from '@/server/auth/session';
import { isPlatformAdmin, canChangePlatformRoles } from '@/server/auth/permissions';
import { AdminUsersPanel } from '@/components/app/AdminUsersPanel';

export const dynamic = 'force-dynamic';

export default async function AdminUsersPage({ params }: { params: { locale: string } }) {
  const locale = (isLocale(params.locale) ? params.locale : 'en') as Locale;
  const dict = getDictionary(locale);
  const user = await getCurrentUser();
  if (!user) redirect(`/${locale}/login`);
  if (!isPlatformAdmin(user.role)) redirect(`/${locale}/app`);

  return (
    <AdminUsersPanel
      locale={locale}
      dict={dict}
      canChangeRoles={canChangePlatformRoles(user.role)}
      selfId={user.id}
    />
  );
}
