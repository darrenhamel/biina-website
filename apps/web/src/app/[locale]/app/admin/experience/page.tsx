import { redirect } from 'next/navigation';
import { isLocale, type Locale } from '@/i18n/config';
import { getDictionary } from '@/i18n/dictionaries';
import { getCurrentUser } from '@/server/auth/session';
import { isPlatformAdmin } from '@/server/auth/permissions';
import { Icon } from '@/components/Icon';
import { EXPERIENCE_PROFILES } from '@/config/experience-profiles';
import { AdminExperiencePanel, type ExperienceRow } from '@/components/app/AdminExperiencePanel';

/** Admin → Experience profiles. Display-only view of the persona configuration. */
export const dynamic = 'force-dynamic';

export default async function AdminExperiencePage({ params }: { params: { locale: string } }) {
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
          <h1 className="mt-4 text-xl font-bold text-ink">{dict.adminExperience.title}</h1>
          <p className="mt-2 text-sm text-ink-soft">{dict.admin.restricted}</p>
        </div>
      </div>
    );
  }

  const profiles: ExperienceRow[] = Object.values(EXPERIENCE_PROFILES).map((p) => ({
    id: p.id,
    label: p.label,
    audienceType: p.audienceType,
    defaultModelProfile: p.defaultModelProfile,
    allowedCapabilities: p.allowedCapabilities,
    recommendedCategories: p.recommendedCategories,
    navigation: p.navigation,
    enabled: p.enabled,
    supervisedOnly: p.supervisedOnly,
    defaultForNewUsers: p.defaultForNewUsers,
  }));

  return <AdminExperiencePanel locale={locale} dict={dict} profiles={profiles} />;
}
