import { createHash } from 'node:crypto';
import type { OAuthCredential } from '@/server/connectors/credentials';

/**
 * Write adapters — the ONLY place an external side-effecting call is made. Reads
 * still go through the connector ConnectorService/ToolExecutionService; writes are
 * isolated here so their execution, idempotency, and result verification are
 * centralized. Every write returns a VERIFIED provider resource id (or an explicit
 * UNKNOWN_OUTCOME) — the model may never claim success without one.
 *
 * The MOCK adapter powers the offline safe demonstration (no real side effects).
 * Real Google/Slack adapters are structural: they require live OAuth write scopes,
 * which are DISABLED by default (see docs/AGENT_ACTIVATION_CHECKLIST.md).
 */

export interface WriteResult {
  outcome: 'SUCCEEDED' | 'FAILED' | 'UNKNOWN_OUTCOME';
  externalResourceId?: string;
  summary?: string;
  error?: string;
  /** True when the provider reported this exact action was already performed. */
  deduped?: boolean;
}

export interface WriteContext {
  operation: string; // 'send' | 'createDraft' | 'createEvent' | 'postMessage' | 'updateRecord' | ...
  args: Record<string, unknown>;
  idempotencyKey: string; // stable per (session, tool, normalized args)
  signal?: AbortSignal;
}

export interface WriteAdapter {
  readonly slug: string;
  perform(cred: OAuthCredential, ctx: WriteContext): Promise<WriteResult>;
}

// ---- Mock adapter (deterministic, no network) ----

type MockBehavior = 'ok' | 'timeout' | 'fail';

/**
 * In-memory idempotency ledger for the mock provider. A real provider would use
 * its own idempotency key / dedupe; here we prove the platform-side guarantee:
 * the same idempotency key never produces a second side effect.
 */
class MockWriteAdapter implements WriteAdapter {
  readonly slug: string;
  private performed = new Map<string, string>(); // idempotencyKey -> externalResourceId
  private behavior: MockBehavior = 'ok';

  constructor(slug: string) {
    this.slug = slug;
  }

  setBehavior(b: MockBehavior): void {
    this.behavior = b;
  }
  reset(): void {
    this.performed.clear();
    this.behavior = 'ok';
  }

  async perform(_cred: OAuthCredential, ctx: WriteContext): Promise<WriteResult> {
    // Idempotency: a repeated key returns the ORIGINAL resource, no new side effect.
    const existing = this.performed.get(ctx.idempotencyKey);
    if (existing) return { outcome: 'SUCCEEDED', externalResourceId: existing, summary: 'Already performed (idempotent).', deduped: true };

    if (this.behavior === 'fail') return { outcome: 'FAILED', error: 'Simulated provider failure.' };
    if (this.behavior === 'timeout') {
      // Ambiguous: the request may or may not have taken effect. Never auto-retry.
      return { outcome: 'UNKNOWN_OUTCOME', error: 'Provider timed out; outcome could not be verified.' };
    }

    const resourceId = `${this.slug}-${ctx.operation}-${createHash('sha256').update(ctx.idempotencyKey).digest('hex').slice(0, 16)}`;
    this.performed.set(ctx.idempotencyKey, resourceId);
    return { outcome: 'SUCCEEDED', externalResourceId: resourceId, summary: `${ctx.operation} completed (mock).` };
  }
}

// ---- Real adapters (structural; require live write scopes) ----

class GmailWriteAdapter implements WriteAdapter {
  readonly slug = 'gmail';
  async perform(cred: OAuthCredential, ctx: WriteContext): Promise<WriteResult> {
    if (ctx.operation !== 'send' && ctx.operation !== 'createDraft') return { outcome: 'FAILED', error: 'Unsupported Gmail operation.' };
    const a = ctx.args as { to?: string[]; cc?: string[]; subject?: string; body?: string };
    const headers = [`To: ${(a.to ?? []).join(', ')}`, a.cc?.length ? `Cc: ${a.cc.join(', ')}` : '', `Subject: ${a.subject ?? ''}`, 'Content-Type: text/plain; charset=UTF-8', '', a.body ?? ''].filter(Boolean).join('\r\n');
    const raw = Buffer.from(headers).toString('base64url');
    const path = ctx.operation === 'send' ? 'messages/send' : 'drafts';
    const payload = ctx.operation === 'send' ? { raw } : { message: { raw } };
    const res = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/${path}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${cred.accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: ctx.signal,
    });
    if (!res.ok) throw new Error(`gmail ${ctx.operation} failed (${res.status})`);
    const j = (await res.json()) as { id?: string };
    if (!j.id) return { outcome: 'UNKNOWN_OUTCOME', error: 'No provider id returned.' };
    return { outcome: 'SUCCEEDED', externalResourceId: j.id, summary: `Gmail ${ctx.operation} ${j.id}` };
  }
}

class CalendarWriteAdapter implements WriteAdapter {
  readonly slug = 'google-calendar';
  async perform(cred: OAuthCredential, ctx: WriteContext): Promise<WriteResult> {
    if (ctx.operation !== 'createEvent') return { outcome: 'FAILED', error: 'Unsupported Calendar operation.' };
    const a = ctx.args as { title?: string; date?: string; time?: string; guests?: string[]; location?: string; durationMinutes?: number };
    const start = new Date(`${a.date}T${a.time ?? '09:00'}:00`);
    const end = new Date(start.getTime() + (a.durationMinutes ?? 30) * 60_000);
    const body = { summary: a.title, location: a.location, start: { dateTime: start.toISOString() }, end: { dateTime: end.toISOString() }, attendees: (a.guests ?? []).map((email) => ({ email })) };
    const res = await fetch('https://www.googleapis.com/calendar/v3/calendars/primary/events', {
      method: 'POST',
      headers: { Authorization: `Bearer ${cred.accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: ctx.signal,
    });
    if (!res.ok) throw new Error(`calendar create failed (${res.status})`);
    const j = (await res.json()) as { id?: string };
    if (!j.id) return { outcome: 'UNKNOWN_OUTCOME', error: 'No provider id returned.' };
    return { outcome: 'SUCCEEDED', externalResourceId: j.id, summary: `Calendar event ${j.id}` };
  }
}

class SlackWriteAdapter implements WriteAdapter {
  readonly slug = 'slack';
  async perform(cred: OAuthCredential, ctx: WriteContext): Promise<WriteResult> {
    if (ctx.operation !== 'postMessage') return { outcome: 'FAILED', error: 'Unsupported Slack operation.' };
    const a = ctx.args as { channel?: string; message?: string };
    const res = await fetch('https://slack.com/api/chat.postMessage', {
      method: 'POST',
      headers: { Authorization: `Bearer ${cred.accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ channel: a.channel, text: a.message }),
      signal: ctx.signal,
    });
    const j = (await res.json()) as { ok?: boolean; ts?: string; error?: string };
    if (!j.ok) throw new Error(`slack post failed (${j.error ?? res.status})`);
    return { outcome: 'SUCCEEDED', externalResourceId: j.ts, summary: `Slack message ${j.ts}` };
  }
}

// ---- Registry (with a test-injection hook) ----

const mocks = new Map<string, MockWriteAdapter>();
const real = new Map<string, WriteAdapter>();
for (const a of [new GmailWriteAdapter(), new CalendarWriteAdapter(), new SlackWriteAdapter()]) real.set(a.slug, a);
let overrides: Map<string, WriteAdapter> | null = null;

/** Resolve the write adapter for a connector. Mock connectors get a mock adapter. */
export function getWriteAdapter(connectorSlug: string): WriteAdapter | null {
  if (overrides?.has(connectorSlug)) return overrides.get(connectorSlug)!;
  // 'mock' and 'crm' use the mock adapter (offline). Real ones require live scopes.
  if (connectorSlug === 'mock' || connectorSlug === 'crm') {
    if (!mocks.has(connectorSlug)) mocks.set(connectorSlug, new MockWriteAdapter(connectorSlug));
    return mocks.get(connectorSlug)!;
  }
  return real.get(connectorSlug) ?? null;
}

/** Test hooks. */
export function setWriteAdapter(slug: string, adapter: WriteAdapter | null): void {
  if (!overrides) overrides = new Map();
  if (adapter) overrides.set(slug, adapter);
  else overrides.delete(slug);
}
export function _mockWriteAdapter(slug: string): MockWriteAdapter {
  if (!mocks.has(slug)) mocks.set(slug, new MockWriteAdapter(slug));
  return mocks.get(slug)!;
}
export function _resetWriteAdapters(): void {
  for (const m of mocks.values()) m.reset();
  overrides = null;
}
