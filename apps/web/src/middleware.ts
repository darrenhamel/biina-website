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
const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const IS_PROD = process.env.NODE_ENV === 'production';

/**
 * Production security headers (Phase 18). Applied to every response. CSP allows only
 * self + the payment provider (Stripe) for scripts/frames/connections; styles keep
 * 'unsafe-inline' (framework-injected styles) but scripts do NOT. HSTS is set only in
 * production over the assumption TLS terminates at the edge. Set CSP_DISABLED=true to
 * fall back to headers-only if a CSP issue is discovered post-deploy.
 */
function securityHeaders(): Record<string, string> {
  const h: Record<string, string> = {
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'X-Frame-Options': 'DENY',
    'Permissions-Policy': 'geolocation=(), camera=(), microphone=(self), payment=(self)',
    'Cross-Origin-Opener-Policy': 'same-origin',
  };
  if (IS_PROD) h['Strict-Transport-Security'] = 'max-age=31536000; includeSubDomains';
  if (process.env.CSP_DISABLED !== 'true') {
    h['Content-Security-Policy'] = [
      "default-src 'self'",
      "base-uri 'self'",
      "object-src 'none'",
      "frame-ancestors 'none'",
      "form-action 'self'",
      "img-src 'self' data: blob:",
      "font-src 'self' data:",
      "style-src 'self' 'unsafe-inline'",
      "script-src 'self' https://js.stripe.com",
      "connect-src 'self' https://api.stripe.com",
      "frame-src https://js.stripe.com https://hooks.stripe.com",
      "media-src 'self' blob: data:",
    ].join('; ');
  }
  return h;
}

function withSecurity(res: NextResponse): NextResponse {
  for (const [k, v] of Object.entries(securityHeaders())) res.headers.set(k, v);
  return res;
}

/**
 * CSRF defense-in-depth: session cookies are SameSite=lax already, but we also
 * reject state-changing API calls whose Origin doesn't match the request host.
 * Only enforced when an Origin header is present (browsers always send it for
 * fetch); same-origin server/tooling calls without Origin are unaffected.
 */
function isCrossOrigin(req: NextRequest): boolean {
  const origin = req.headers.get('origin');
  if (!origin) return false;
  try {
    const originHost = new URL(origin).host;
    const host = req.headers.get('x-forwarded-host') ?? req.headers.get('host') ?? req.nextUrl.host;
    return originHost !== host;
  } catch {
    return true; // unparseable Origin → treat as cross-origin
  }
}

function pickLocale(req: NextRequest): string {
  const cookieLocale = req.cookies.get('biina_locale')?.value;
  if (cookieLocale && (locales as readonly string[]).includes(cookieLocale)) return cookieLocale;

  const header = req.headers.get('accept-language') ?? '';
  if (/(^|,|\s)ar\b/i.test(header)) return 'ar';
  return defaultLocale;
}

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // API: enforce same-origin on state-changing requests (CSRF), then pass through.
  if (pathname.startsWith('/api')) {
    if (MUTATING.has(req.method) && isCrossOrigin(req)) {
      return withSecurity(NextResponse.json({ error: 'Cross-origin request refused' }, { status: 403 }));
    }
    return withSecurity(NextResponse.next());
  }

  // Skip Next internals and static files.
  if (pathname.startsWith('/_next') || pathname === '/favicon.ico' || PUBLIC_FILE.test(pathname)) {
    return NextResponse.next();
  }

  const hasLocale = (locales as readonly string[]).some(
    (l) => pathname === `/${l}` || pathname.startsWith(`/${l}/`),
  );

  if (!hasLocale) {
    const locale = pickLocale(req);
    const url = req.nextUrl.clone();
    url.pathname = `/${locale}${pathname === '/' ? '' : pathname}`;
    return withSecurity(NextResponse.redirect(url));
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
      return withSecurity(NextResponse.redirect(url));
    }
  }

  return withSecurity(NextResponse.next());
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
