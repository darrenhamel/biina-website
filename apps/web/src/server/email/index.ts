import { logger } from '@/lib/logger';
import { isProduction, devFeaturesAllowed } from '@/server/config/production';

/**
 * Provider-independent email service. Core identity logic depends only on this
 * interface, never on a commercial email vendor. The development provider logs a link
 * ONLY outside production; the Resend adapter delivers real mail in production. The
 * API key is server-side only and never logged. Production refuses the mock provider.
 */

export interface OutgoingEmail {
  to: string;
  subject: string;
  text: string;
  /** The primary action link (verification/reset/invite), for dev logging only. */
  actionUrl?: string;
}

export interface EmailProvider {
  readonly name: string;
  send(email: OutgoingEmail): Promise<void>;
}

class DevelopmentEmailProvider implements EmailProvider {
  readonly name = 'dev';
  async send(email: OutgoingEmail): Promise<void> {
    const isProd = process.env.NODE_ENV === 'production';
    logger.info('email.send', {
      provider: this.name,
      to: redactEmail(email.to),
      subject: email.subject,
      // NEVER log the token-bearing URL in production.
      devActionUrl: isProd ? '[hidden in production]' : email.actionUrl,
    });
  }
}

/**
 * Resend transactional email adapter. Uses the Resend REST API over fetch (no SDK
 * dependency). RESEND_API_KEY is read server-side and never logged; EMAIL_FROM is the
 * verified sender. Authentication/security emails are sent WITHOUT open/click tracking.
 */
class ResendEmailProvider implements EmailProvider {
  readonly name = 'resend';
  constructor(private apiKey: string, private from: string, private replyTo?: string) {}
  async send(email: OutgoingEmail): Promise<void> {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { authorization: `Bearer ${this.apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        from: this.from,
        to: [email.to],
        subject: email.subject,
        text: email.text,
        ...(this.replyTo ? { reply_to: this.replyTo } : {}),
        // Never track auth/security emails.
        tags: [{ name: 'category', value: 'transactional' }],
      }),
    });
    if (!res.ok) {
      // Surface a safe error; never log the API key or the token-bearing URL.
      const status = res.status;
      logger.error('email.send_failed', { provider: this.name, to: redactEmail(email.to), subject: email.subject, status });
      throw new Error(`Email delivery failed (${status}).`);
    }
    logger.info('email.send', { provider: this.name, to: redactEmail(email.to), subject: email.subject });
  }
}

let provider: EmailProvider | null = null;

export function getEmailService(): EmailProvider {
  if (provider) return provider;
  const kind = (process.env.EMAIL_PROVIDER || 'dev').toLowerCase();
  if (kind === 'resend') {
    const apiKey = process.env.RESEND_API_KEY;
    const from = process.env.EMAIL_FROM;
    if (!apiKey || !from) throw new Error('EMAIL_PROVIDER=resend requires RESEND_API_KEY and EMAIL_FROM.');
    provider = new ResendEmailProvider(apiKey, from, process.env.EMAIL_REPLY_TO);
    return provider;
  }
  // PRODUCTION GUARD: the mock/dev provider does not deliver mail and must never serve
  // production (verification/reset/invite would silently never arrive).
  if (isProduction() && !devFeaturesAllowed()) {
    throw new Error('No production email provider configured (set EMAIL_PROVIDER=resend + RESEND_API_KEY + EMAIL_FROM).');
  }
  provider = new DevelopmentEmailProvider();
  return provider;
}

/** For tests — reset the cached provider so env changes take effect. */
export function _resetEmailService(): void {
  provider = null;
}

/** True when we can safely surface an action link to the caller (dev testing). */
export function devLinksEnabled(): boolean {
  return process.env.NODE_ENV !== 'production' || process.env.EMAIL_DEV_LINKS === 'true';
}

function redactEmail(email: string): string {
  const [name, domain] = email.split('@');
  if (!domain) return '***';
  return `${name.slice(0, 2)}***@${domain}`;
}

// ---- Templates (kept minimal + modular) ----

export const emailTemplates = {
  verify: (url: string): OutgoingEmail => ({
    to: '',
    subject: 'Verify your BIINA email',
    text: `Welcome to BIINA. Confirm your email address by visiting:\n${url}\n\nThis link expires in 24 hours. If you didn't create a BIINA account, ignore this message.`,
    actionUrl: url,
  }),
  reset: (url: string): OutgoingEmail => ({
    to: '',
    subject: 'Reset your BIINA password',
    text: `We received a request to reset your BIINA password. Reset it here:\n${url}\n\nThis link expires in 1 hour and can be used once. If you didn't request this, you can safely ignore it.`,
    actionUrl: url,
  }),
  orgInvite: (orgName: string, url: string): OutgoingEmail => ({
    to: '',
    subject: `You've been invited to join ${orgName} on BIINA`,
    text: `You've been invited to join ${orgName} on BIINA. Accept the invitation here:\n${url}\n\nThis invitation expires in 7 days.`,
    actionUrl: url,
  }),
};
