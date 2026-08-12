import { logger } from '@/lib/logger';

/**
 * Provider-independent email service. Core identity logic depends only on this
 * interface, never on a commercial email vendor. Phase 6 ships a development
 * provider; SMTP/Resend/SES adapters can be added later without touching callers.
 *
 * Development safety: the dev provider logs a link ONLY outside production, so
 * verification/reset tokens are never exposed in production logs.
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

let provider: EmailProvider | null = null;

export function getEmailService(): EmailProvider {
  if (provider) return provider;
  const kind = process.env.EMAIL_PROVIDER || 'dev';
  switch (kind) {
    // Future: case 'smtp' / 'resend' / 'ses' → real adapters.
    case 'dev':
    default:
      provider = new DevelopmentEmailProvider();
  }
  return provider;
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
