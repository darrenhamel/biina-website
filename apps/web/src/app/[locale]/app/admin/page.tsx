import Link from 'next/link';
import { redirect } from 'next/navigation';
import { sql } from 'drizzle-orm';
import { isLocale, type Locale } from '@/i18n/config';
import { getDictionary } from '@/i18n/dictionaries';
import { getCurrentUser } from '@/server/auth/session';
import { isPlatformAdmin } from '@/server/auth/permissions';
import { getDb } from '@/server/db';
import { users, conversations, messages } from '@/server/db/schema';
import { Icon } from '@/components/Icon';

export const dynamic = 'force-dynamic';

async function count(table: typeof users | typeof conversations | typeof messages) {
  const [row] = await getDb().select({ n: sql<number>`count(*)::int` }).from(table);
  return row?.n ?? 0;
}

export default async function AdminPage({ params }: { params: { locale: string } }) {
  const locale = (isLocale(params.locale) ? params.locale : 'en') as Locale;
  const dict = getDictionary(locale);

  const user = await getCurrentUser();
  if (!user) redirect(`/${locale}/login`);

  // Basic authorization: admin-only area.
  if (!isPlatformAdmin(user.role)) {
    return (
      <div className="grid h-full place-items-center px-6 text-center">
        <div className="max-w-sm">
          <div className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-accent-soft text-accent">
            <Icon name="shield" />
          </div>
          <h1 className="mt-4 text-xl font-bold text-ink">{dict.admin.title}</h1>
          <p className="mt-2 text-sm text-ink-soft">{dict.admin.restricted}</p>
        </div>
      </div>
    );
  }

  const [userCount, convCount, msgCount] = await Promise.all([
    count(users),
    count(conversations),
    count(messages),
  ]);

  const stats = [
    { label: dict.nav.account, value: userCount },
    { label: dict.chat.conversations, value: convCount },
    { label: 'Messages', value: msgCount },
  ];

  return (
    <div className="scroll-slim h-full overflow-y-auto">
      <div className="mx-auto max-w-3xl px-5 py-8">
        <h1 className="text-2xl font-bold tracking-tight text-ink">{dict.admin.title}</h1>
        <p className="mt-1 text-sm text-ink-soft">{dict.admin.subtitle}</p>

        <h2 className="mt-6 text-sm font-semibold text-ink-soft">{dict.admin.usersHeading}</h2>
        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          {stats.map((s) => (
            <div key={s.label} className="card p-5">
              <p className="text-3xl font-bold text-ink">{s.value}</p>
              <p className="mt-1 text-sm text-ink-soft">{s.label}</p>
            </div>
          ))}
        </div>

        <div className="mt-4 grid gap-3">
          <AdminLink href={`/${locale}/app/admin/users`} icon="user" title={dict.admin.users} sub={dict.admin.usersSub} />
          <AdminLink href={`/${locale}/app/admin/orgs`} icon="templates" title={dict.admin.orgs} sub={dict.admin.orgsSub} />
          <AdminLink href={`/${locale}/app/admin/ai`} icon="spark" title={dict.admin.aiControl} sub={dict.admin.aiControlSub} />
          <AdminLink href={`/${locale}/app/admin/rag`} icon="files" title={dict.adminRag.title} sub={dict.adminRag.subtitle} />
          <AdminLink href={`/${locale}/app/admin/web`} icon="globe" title={dict.adminWeb.title} sub={dict.adminWeb.subtitle} />
          <AdminLink href={`/${locale}/app/admin/connectors`} icon="spark" title={dict.adminConnectors.title} sub={dict.adminConnectors.subtitle} />
          <AdminLink href={`/${locale}/app/admin/agents`} icon="agents" title={dict.adminAgents.title} sub={dict.adminAgents.subtitle} />
          <AdminLink href={`/${locale}/app/admin/memory`} icon="spark" title={dict.adminMemory.title} sub={dict.adminMemory.subtitle} />
          <AdminLink href={`/${locale}/app/admin/automations`} icon="clock" title={dict.adminAutomations.title} sub={dict.adminAutomations.subtitle} />
          <AdminLink href={`/${locale}/app/admin/usage`} icon="discover" title={dict.admin.usageCost} sub={dict.admin.usageCostSub} />
          <AdminLink href={`/${locale}/app/admin/plans`} icon="templates" title={dict.admin.plans} sub={dict.admin.plansSub} />
          <AdminLink href={`/${locale}/app/admin/billing`} icon="spark" title={dict.adminBilling.title} sub={dict.adminBilling.subtitle} />
        </div>
      </div>
    </div>
  );
}

function AdminLink({ href, icon, title, sub }: { href: string; icon: string; title: string; sub: string }) {
  return (
    <Link href={href} className="card flex items-center justify-between p-5 transition-colors hover:border-accent">
      <span className="flex items-center gap-3">
        <span className="grid h-10 w-10 place-items-center rounded-xl bg-accent-soft text-accent">
          <Icon name={icon} />
        </span>
        <span>
          <span className="block font-semibold text-ink">{title}</span>
          <span className="block text-sm text-ink-soft">{sub}</span>
        </span>
      </span>
      <Icon name="send" width={18} height={18} />
    </Link>
  );
}
