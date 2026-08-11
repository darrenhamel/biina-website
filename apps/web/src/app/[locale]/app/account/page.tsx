import { redirect } from 'next/navigation';
import { isLocale, type Locale } from '@/i18n/config';
import { getDictionary } from '@/i18n/dictionaries';
import { getCurrentUser } from '@/server/auth/session';

export const dynamic = 'force-dynamic';

export default async function AccountPage({ params }: { params: { locale: string } }) {
  const locale = (isLocale(params.locale) ? params.locale : 'en') as Locale;
  const dict = getDictionary(locale);
  const user = await getCurrentUser();
  if (!user) redirect(`/${locale}/login`);

  const memberSince = new Intl.DateTimeFormat(locale === 'ar' ? 'ar-AE' : 'en-US', {
    dateStyle: 'long',
  }).format(user.createdAt);

  const rows = [
    { label: dict.account.email, value: user.email },
    { label: dict.account.role, value: user.role },
    { label: dict.account.memberSince, value: memberSince },
  ];

  return (
    <div className="scroll-slim h-full overflow-y-auto">
      <div className="mx-auto max-w-2xl px-5 py-8">
        <h1 className="text-2xl font-bold tracking-tight text-ink">{dict.account.title}</h1>
        <div className="mt-6 card divide-y divide-line">
          {rows.map((r) => (
            <div key={r.label} className="flex items-center justify-between px-5 py-4">
              <span className="text-sm text-ink-soft">{r.label}</span>
              <span className="text-sm font-medium text-ink">{r.value}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
