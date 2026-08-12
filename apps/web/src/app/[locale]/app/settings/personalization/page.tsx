import { redirect } from 'next/navigation';
import { isLocale, type Locale } from '@/i18n/config';
import { getDictionary } from '@/i18n/dictionaries';
import { getCurrentUser } from '@/server/auth/session';
import { listUserOrgs } from '@/server/org/organizations';
import { MemorySettingsPanel } from '@/components/app/MemorySettingsPanel';

export const dynamic = 'force-dynamic';

export default async function PersonalizationPage({ params }: { params: { locale: string } }) {
  const locale = (isLocale(params.locale) ? params.locale : 'en') as Locale;
  const dict = getDictionary(locale);
  const user = await getCurrentUser();
  if (!user) redirect(`/${locale}/login`);

  const orgs = await listUserOrgs(user.id);

  return <MemorySettingsPanel locale={locale} dict={dict} hasOrganizations={orgs.length > 0} />;
}
