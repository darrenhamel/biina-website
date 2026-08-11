import { redirect } from 'next/navigation';
import { sql } from 'drizzle-orm';
import { isLocale, type Locale } from '@/i18n/config';
import { getDictionary } from '@/i18n/dictionaries';
import { getCurrentUser } from '@/server/auth/session';
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
  if (user.role !== 'ADMIN') {
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
      </div>
    </div>
  );
}
