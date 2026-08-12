import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { isLocale, type Locale } from '@/i18n/config';
import { getDictionary } from '@/i18n/dictionaries';
import { getCurrentUser } from '@/server/auth/session';
import { listConversations } from '@/server/conversations';
import { listUserOrgs } from '@/server/org/organizations';
import { AppShell } from '@/components/app/AppShell';

export const dynamic = 'force-dynamic';

export default async function AppLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: { locale: string };
}) {
  const locale = (isLocale(params.locale) ? params.locale : 'en') as Locale;
  const dict = getDictionary(locale);

  // Authoritative auth check (middleware only checks cookie presence).
  const user = await getCurrentUser();
  if (!user) redirect(`/${locale}/login`);

  const [conversations, orgs] = await Promise.all([listConversations(user.id), listUserOrgs(user.id)]);
  const activeWorkspace = cookies().get('biina_workspace')?.value ?? 'personal';

  return (
    <AppShell
      locale={locale}
      dict={dict}
      user={{ displayName: user.displayName, email: user.email, role: user.role }}
      conversations={conversations.map((c) => ({ id: c.id, title: c.title }))}
      organizations={orgs.map((o) => ({ slug: o.slug, displayName: o.displayName }))}
      activeWorkspace={activeWorkspace}
    >
      {children}
    </AppShell>
  );
}
