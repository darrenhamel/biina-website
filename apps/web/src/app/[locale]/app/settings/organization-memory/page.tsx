import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { isLocale, type Locale } from '@/i18n/config';
import { getDictionary } from '@/i18n/dictionaries';
import { getCurrentUser } from '@/server/auth/session';
import { resolveOrgContext } from '@/server/org/organizations';
import { isOrgManager } from '@/server/auth/permissions';
import { WORKSPACE_COOKIE } from '@/server/org/constants';
import { Icon } from '@/components/Icon';
import { MemoryManager } from '@/components/app/MemoryManager';

export const dynamic = 'force-dynamic';

export default async function OrganizationMemoryPage({ params }: { params: { locale: string } }) {
  const locale = (isLocale(params.locale) ? params.locale : 'en') as Locale;
  const dict = getDictionary(locale);
  const user = await getCurrentUser();
  if (!user) redirect(`/${locale}/login`);

  // Resolve the active workspace (cookie is a hint; membership is verified here).
  const slug = cookies().get(WORKSPACE_COOKIE)?.value;
  const ctx = slug && slug !== 'personal' ? await resolveOrgContext(user.id, slug) : null;
  const inOrg = Boolean(ctx && ctx.org.status === 'ACTIVE');
  const canManage = Boolean(ctx && ctx.org.status === 'ACTIVE' && isOrgManager(ctx.role));

  return (
    <div className="scroll-slim h-full overflow-y-auto">
      <div className="mx-auto max-w-2xl px-5 py-8">
        <h1 className="text-2xl font-bold tracking-tight text-ink">{dict.personalization.orgTitle}</h1>
        <p className="mt-1 text-sm text-ink-soft">{dict.personalization.orgSubtitle}</p>

        {!inOrg ? (
          <div className="mt-6 grid place-items-center rounded-2xl border border-dashed border-line px-6 py-12 text-center">
            <div className="grid h-11 w-11 place-items-center rounded-2xl bg-accent-soft text-accent">
              <Icon name="user" />
            </div>
            <p className="mt-3 max-w-sm text-sm text-ink-soft">{dict.personalization.orgNotInWorkspace}</p>
          </div>
        ) : (
          <>
            {!canManage && (
              <p className="mt-4 rounded-lg bg-paper-sunken px-3 py-2 text-sm text-ink-soft">
                {dict.personalization.orgReadOnly}
              </p>
            )}
            <div className="mt-6">
              <MemoryManager locale={locale} dict={dict} ownerType="ORGANIZATION" canManage={canManage} enabled />
            </div>
          </>
        )}
      </div>
    </div>
  );
}
