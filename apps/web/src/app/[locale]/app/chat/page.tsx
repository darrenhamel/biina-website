import { isLocale, type Locale } from '@/i18n/config';
import { getDictionary } from '@/i18n/dictionaries';
import { ChatWorkspace } from '@/components/app/ChatWorkspace';

export const dynamic = 'force-dynamic';

export default function NewChatPage({ params }: { params: { locale: string } }) {
  const locale = (isLocale(params.locale) ? params.locale : 'en') as Locale;
  const dict = getDictionary(locale);
  return <ChatWorkspace locale={locale} dict={dict} initialMessages={[]} />;
}
