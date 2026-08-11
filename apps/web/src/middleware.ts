import { NextRequest, NextResponse } from 'next/server';
import { locales, defaultLocale } from '@/i18n/config';
import { SESSION_COOKIE } from '@/server/auth/constants';

/**
 * Middleware: locale prefixing + a cheap auth gate.
 *
 *  - Ensures every page URL is locale-prefixed (/en/…, /ar/…). Locale is chosen
 *    from the cookie, then Accept-Language, then the default.
 *  - Redirects unauthenticated users away from /{locale}/app/* to login. This is
 *    a fast cookie-presence check only; authoritative validation happens
 *    server-side (getCurrentUser) — a forged cookie still can't load real data.
 */

const PUBLIC_FILE = /\.(.*)$/;

function pickLocale(req: NextRequest): string {
  const cookieLocale = req.cookies.get('biina_locale')?.value;
  if (cookieLocale && (locales as readonly string[]).includes(cookieLocale)) return cookieLocale;

  const header = req.headers.get('accept-language') ?? '';
  if (/(^|,|\s)ar\b/i.test(header)) return 'ar';
  return defaultLocale;
}

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Skip API, Next internals, and static files.
  if (
    pathname.startsWith('/api') ||
    pathname.startsWith('/_next') ||
    pathname === '/favicon.ico' ||
    PUBLIC_FILE.test(pathname)
  ) {
    return NextResponse.next();
  }

  const hasLocale = (locales as readonly string[]).some(
    (l) => pathname === `/${l}` || pathname.startsWith(`/${l}/`),
  );

  if (!hasLocale) {
    const locale = pickLocale(req);
    const url = req.nextUrl.clone();
    url.pathname = `/${locale}${pathname === '/' ? '' : pathname}`;
    return NextResponse.redirect(url);
  }

  // Auth gate for the product area.
  const segments = pathname.split('/'); // ['', locale, 'app', ...]
  const locale = segments[1];
  const isAppArea = segments[2] === 'app';
  if (isAppArea) {
    const hasSession = Boolean(req.cookies.get(SESSION_COOKIE)?.value);
    if (!hasSession) {
      const url = req.nextUrl.clone();
      url.pathname = `/${locale}/login`;
      url.searchParams.set('next', pathname);
      return NextResponse.redirect(url);
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
