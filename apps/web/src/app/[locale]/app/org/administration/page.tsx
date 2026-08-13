import { redirect } from 'next/navigation';
import { isLocale, type Locale } from '@/i18n/config';
import { getDictionary } from '@/i18n/dictionaries';
import { getCurrentUser } from '@/server/auth/session';
import { OrgAdministrationPanel } from '@/components/app/OrgAdministrationPanel';

/**
 * Org → Administration. The enterprise control layer.
 *
 * Auth-gated here (must be signed in); the per-section enterprise permission and
 * plan/flag checks are enforced by the API routes, which return 403 handled
 * inline by the panel.
 */
export const dynamic = 'force-dynamic';

export default async function OrgAdministrationPage({ params }: { params: { locale: string } }) {
  const locale = (isLocale(params.locale) ? params.locale : 'en') as Locale;
  const dict = getDictionary(locale);

  const user = await getCurrentUser();
  if (!user) redirect(`/${locale}/login`);

  return <OrgAdministrationPanel locale={locale} dict={dict} />;
}
