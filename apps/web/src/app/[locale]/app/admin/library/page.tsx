import { redirect } from 'next/navigation';
import { isLocale, type Locale } from '@/i18n/config';
import { getDictionary } from '@/i18n/dictionaries';
import { getCurrentUser } from '@/server/auth/session';
import { isPlatformAdmin } from '@/server/auth/permissions';
import { Icon } from '@/components/Icon';
import { AdminLibraryPanel } from '@/components/app/AdminLibraryPanel';

/** Admin → Library. Authorization enforced server-side (not just hidden nav). */
export const dynamic = 'force-dynamic';

export default async function AdminLibraryPage({ params }: { params: { locale: string } }) {
  const locale = (isLocale(params.locale) ? params.locale : 'en') as Locale;
  const dict = getDictionary(locale);

  const user = await getCurrentUser();
  if (!user) redirect(`/${locale}/login`);
  if (!isPlatformAdmin(user.role)) {
    return (
      <div className="grid h-full place-items-center px-6 text-center">
        <div className="max-w-sm">
          <div className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-accent-soft text-accent">
            <Icon name="shield" />
          </div>
          <h1 className="mt-4 text-xl font-bold text-ink">{dict.adminLibrary.title}</h1>
          <p className="mt-2 text-sm text-ink-soft">{dict.admin.restricted}</p>
        </div>
      </div>
    );
  }

  return <AdminLibraryPanel locale={locale} dict={dict} />;
}
