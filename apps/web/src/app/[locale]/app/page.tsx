import { redirect } from 'next/navigation';
import { isLocale } from '@/i18n/config';

export default function AppIndex({ params }: { params: { locale: string } }) {
  const locale = isLocale(params.locale) ? params.locale : 'en';
  redirect(`/${locale}/app/chat`);
}
