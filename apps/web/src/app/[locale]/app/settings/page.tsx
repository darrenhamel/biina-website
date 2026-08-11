import { redirect } from 'next/navigation';
import { isLocale, type Locale } from '@/i18n/config';
import { getDictionary } from '@/i18n/dictionaries';
import { getCurrentUser } from '@/server/auth/session';
import { getPersona } from '@/config/personas';
import { SettingsForm } from '@/components/app/SettingsForm';

export const dynamic = 'force-dynamic';

export default async function SettingsPage({ params }: { params: { locale: string } }) {
  const locale = (isLocale(params.locale) ? params.locale : 'en') as Locale;
  const dict = getDictionary(locale);
  const user = await getCurrentUser();
  if (!user) redirect(`/${locale}/login`);

  const persona = getPersona(user.personaId);
  const userLocale = (isLocale(user.locale) ? user.locale : 'en') as Locale;

  return (
    <div className="scroll-slim h-full overflow-y-auto">
      <div className="mx-auto max-w-2xl px-5 py-8">
        <h1 className="text-2xl font-bold tracking-tight text-ink">{dict.settings.title}</h1>
        <div className="mt-6">
          <SettingsForm
            locale={locale}
            dict={dict}
            initial={{ displayName: user.displayName, locale: userLocale, personaId: persona.id }}
          />
        </div>
      </div>
    </div>
  );
}
