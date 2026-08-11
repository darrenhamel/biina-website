import { isLocale, type Locale } from '@/i18n/config';
import { getDictionary } from '@/i18n/dictionaries';
import { PagePlaceholder } from '@/components/app/PagePlaceholder';

export default function FilesPage({ params }: { params: { locale: string } }) {
  const locale = (isLocale(params.locale) ? params.locale : 'en') as Locale;
  const dict = getDictionary(locale);
  return (
    <PagePlaceholder icon="files" title={dict.nav.files} comingSoonLabel={dict.common.comingSoon} />
  );
}
