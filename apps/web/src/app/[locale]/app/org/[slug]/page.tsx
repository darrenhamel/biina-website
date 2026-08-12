import { redirect } from 'next/navigation';
import { isLocale, type Locale } from '@/i18n/config';
import { getDictionary } from '@/i18n/dictionaries';
import { getCurrentUser } from '@/server/auth/session';
import { OrgWorkspace } from '@/components/app/OrgWorkspace';

export const dynamic = 'force-dynamic';

export default async function OrgPage({ params }: { params: { locale: string; slug: string } }) {
  const locale = (isLocale(params.locale) ? params.locale : 'en') as Locale;
  const dict = getDictionary(locale);
  const user = await getCurrentUser();
  if (!user) redirect(`/${locale}/login`);

  return <OrgWorkspace slug={params.slug} locale={locale} dict={dict} selfUserId={user.id} />;
}
