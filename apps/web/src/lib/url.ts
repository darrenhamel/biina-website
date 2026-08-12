import type { NextRequest } from 'next/server';

/**
 * Resolve the app's public base URL. Prefer an explicit APP_URL (production),
 * else derive from the request's forwarded host/proto. Used to build absolute
 * links for verification / reset / invitation emails.
 */
export function appBaseUrl(req: NextRequest): string {
  if (process.env.APP_URL) return process.env.APP_URL.replace(/\/+$/, '');
  const proto = req.headers.get('x-forwarded-proto') ?? (process.env.NODE_ENV === 'production' ? 'https' : 'http');
  const host = req.headers.get('x-forwarded-host') ?? req.headers.get('host') ?? 'localhost:3000';
  return `${proto}://${host}`;
}
