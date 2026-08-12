import { redirect } from 'next/navigation';
import { isLocale, type Locale } from '@/i18n/config';
import { getDictionary } from '@/i18n/dictionaries';
import { getCurrentUser } from '@/server/auth/session';
import { KnowledgeBaseDetail } from '@/components/app/KnowledgeBaseDetail';

export const dynamic = 'force-dynamic';

export default async function KnowledgeBasePage({
  params,
}: {
  params: { locale: string; id: string };
}) {
  const locale = (isLocale(params.locale) ? params.locale : 'en') as Locale;
  const dict = getDictionary(locale);
  const user = await getCurrentUser();
  if (!user) redirect(`/${locale}/login`);

  return <KnowledgeBaseDetail locale={locale} dict={dict} kbId={params.id} />;
}
