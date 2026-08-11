import { redirect } from 'next/navigation';
import { isLocale, type Locale } from '@/i18n/config';
import { getDictionary } from '@/i18n/dictionaries';
import { getCurrentUser } from '@/server/auth/session';
import { getOwnedConversation, listMessages } from '@/server/conversations';
import { ChatWorkspace } from '@/components/app/ChatWorkspace';

export const dynamic = 'force-dynamic';

export default async function ConversationPage({
  params,
}: {
  params: { locale: string; conversationId: string };
}) {
  const locale = (isLocale(params.locale) ? params.locale : 'en') as Locale;
  const dict = getDictionary(locale);

  const user = await getCurrentUser();
  if (!user) redirect(`/${locale}/login`);

  const conversation = await getOwnedConversation(user.id, params.conversationId);
  if (!conversation) redirect(`/${locale}/app/chat`);

  const rows = await listMessages(conversation.id);
  const initialMessages = rows
    .filter((m) => m.role !== 'system')
    .map((m) => ({ id: m.id, role: m.role as 'user' | 'assistant', content: m.content }));

  return (
    <ChatWorkspace
      key={conversation.id}
      locale={locale}
      dict={dict}
      conversationId={conversation.id}
      initialMessages={initialMessages}
    />
  );
}
