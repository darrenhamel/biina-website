import { assertPublicUrl, SsrfBlockedError } from './ssrf';
import { fetchConfig } from './config';

/**
 * Controlled public-web page fetcher. NOT a generic URL proxy: every hop is
 * SSRF-validated, redirects are followed manually (each target re-validated),
 * responses are size-capped and time-limited, and only text/HTML/PDF content is
 * accepted. Uses an identifiable user-agent and never sends credentials.
 */

const ALLOWED_CONTENT = [/^text\/html/i, /^text\/plain/i, /^application\/xhtml\+xml/i, /^application\/pdf/i];

export interface FetchedPage {
  finalUrl: string;
  status: number;
  contentType: string;
  body: Buffer;
  truncated: boolean;
  ok: boolean;
}

export interface WebPageFetcher {
  readonly name: string;
  fetch(url: string, signal?: AbortSignal): Promise<FetchedPage>;
}

export class FetchBlockedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FetchBlockedError';
  }
}

class SafeWebPageFetcher implements WebPageFetcher {
  readonly name = 'safe-http';

  async fetch(url: string, signal?: AbortSignal): Promise<FetchedPage> {
    const cfg = fetchConfig();
    let current = url;
    let redirects = 0;

    while (true) {
      await assertPublicUrl(current); // throws SsrfBlockedError on a non-public target
      const timeout = AbortSignal.timeout(cfg.timeoutMs);
      const composite = signal ? AbortSignal.any([signal, timeout]) : timeout;

      const res = await fetch(current, {
        method: 'GET',
        redirect: 'manual',
        signal: composite,
        headers: { 'User-Agent': cfg.userAgent, Accept: 'text/html,application/xhtml+xml,text/plain,application/pdf' },
      }).catch((e: unknown) => {
        if ((e as Error)?.name === 'AbortError') throw new FetchBlockedError('fetch timed out or was cancelled');
        throw new FetchBlockedError(`fetch failed: ${String((e as Error)?.message ?? e)}`);
      });

      // Manual redirect handling — re-validate every hop (public → private is blocked).
      if (res.status >= 300 && res.status < 400) {
        const loc = res.headers.get('location');
        if (!loc) throw new FetchBlockedError('redirect without location');
        if (++redirects > cfg.maxRedirects) throw new FetchBlockedError('too many redirects');
        current = new URL(loc, current).toString();
        continue;
      }

      const contentType = res.headers.get('content-type') || '';
      if (!ALLOWED_CONTENT.some((re) => re.test(contentType))) {
        throw new FetchBlockedError(`unsupported content-type: ${contentType || 'unknown'}`);
      }

      // Read with a hard byte cap (reject/limit oversized responses).
      const { body, truncated } = await readCapped(res, cfg.maxBytes);
      return { finalUrl: current, status: res.status, contentType, body, truncated, ok: res.ok };
    }
  }
}

async function readCapped(res: Response, maxBytes: number): Promise<{ body: Buffer; truncated: boolean }> {
  if (!res.body) return { body: Buffer.alloc(0), truncated: false };
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  let truncated = false;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      total += value.length;
      if (total > maxBytes) {
        chunks.push(value.subarray(0, Math.max(0, value.length - (total - maxBytes))));
        truncated = true;
        try { await reader.cancel(); } catch { /* ignore */ }
        break;
      }
      chunks.push(value);
    }
  }
  return { body: Buffer.concat(chunks.map((c) => Buffer.from(c))), truncated };
}

let cached: WebPageFetcher | null = null;
let override: WebPageFetcher | null = null;
export function getWebPageFetcher(): WebPageFetcher {
  if (override) return override;
  if (!cached) cached = new SafeWebPageFetcher();
  return cached;
}
export function setWebPageFetcher(f: WebPageFetcher | null): void {
  override = f;
  cached = null;
}
export { SsrfBlockedError };
