import { isIP } from 'node:net';
import { lookup } from 'node:dns/promises';

/**
 * SSRF protection — the security core of web fetching. Biina.ai must never become
 * a proxy into internal infrastructure. Before ANY fetch (and on EVERY redirect
 * hop) a URL passes `assertPublicUrl`:
 *   1. scheme must be http/https (no file/data/javascript/ftp/gopher/…);
 *   2. an IP literal is classified directly;
 *   3. a hostname is DNS-resolved and EVERY resolved address must be a public,
 *      globally-routable unicast address — loopback / private / link-local /
 *      unique-local / CGNAT / cloud-metadata (169.254.169.254) are all blocked.
 * Re-validating on each hop mitigates redirect-based bypass; re-resolving right
 * before connect narrows the DNS-rebinding window (documented in RAG/WEB_SECURITY).
 */

export class SsrfBlockedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SsrfBlockedError';
  }
}

export function isValidWebScheme(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

/** Parse "a.b.c.d" → octets, or null. */
function ipv4Octets(ip: string): number[] | null {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(ip);
  if (!m) return null;
  const o = m.slice(1).map(Number);
  return o.every((n) => n >= 0 && n <= 255) ? o : null;
}

/** True if an IPv4 address is NOT a safe public address. */
export function isBlockedIpv4(ip: string): boolean {
  const o = ipv4Octets(ip);
  if (!o) return true; // unparseable → block
  const [a, b] = o;
  if (a === 0) return true; // 0.0.0.0/8 "this host"
  if (a === 10) return true; // private
  if (a === 127) return true; // loopback
  if (a === 169 && b === 254) return true; // link-local incl. 169.254.169.254 metadata
  if (a === 172 && b >= 16 && b <= 31) return true; // private
  if (a === 192 && b === 168) return true; // private
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT 100.64/10
  if (a === 192 && b === 0 && o[2] === 0) return true; // 192.0.0/24
  if (a === 198 && (b === 18 || b === 19)) return true; // benchmarking 198.18/15
  if (a >= 224) return true; // multicast/reserved 224/4 + 240/4 + 255.255.255.255
  return false;
}

/** True if an IPv6 address is NOT a safe public (global unicast 2000::/3) address. */
export function isBlockedIpv6(ip: string): boolean {
  const lc = ip.toLowerCase().split('%')[0]; // strip zone id
  // IPv4-mapped / -compatible → classify the embedded v4.
  const mapped = /(?:::ffff:)(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/.exec(lc);
  if (mapped) return isBlockedIpv4(mapped[1]);
  if (lc === '::1' || lc === '::') return true; // loopback / unspecified
  const first = lc.split(':')[0] || '0';
  const hi = parseInt(first.padEnd(4, '0').slice(0, 4), 16);
  if (Number.isNaN(hi)) return true;
  if ((hi & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
  if ((hi & 0xfe00) === 0xfc00) return true; // fc00::/7 unique-local
  if ((hi & 0xe000) === 0x2000) return false; // 2000::/3 global unicast → allowed
  return true; // everything else (incl. multicast ff00::/8) blocked
}

export function isBlockedIp(ip: string): boolean {
  const fam = isIP(ip);
  if (fam === 4) return isBlockedIpv4(ip);
  if (fam === 6) return isBlockedIpv6(ip);
  return true; // not an IP → block (caller should pass a real address)
}

/**
 * Assert a URL is safe to fetch. Throws SsrfBlockedError otherwise. Resolves DNS
 * for hostnames and blocks if ANY resolved address is non-public. Returns the URL.
 */
export async function assertPublicUrl(url: string): Promise<URL> {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    throw new SsrfBlockedError('Malformed URL');
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') {
    throw new SsrfBlockedError(`Blocked scheme: ${u.protocol}`);
  }
  const host = u.hostname;
  // Reject obvious internal hostnames outright.
  if (/^(localhost|.*\.local|.*\.internal|.*\.localdomain)$/i.test(host)) {
    throw new SsrfBlockedError('Blocked internal hostname');
  }
  if (isIP(host)) {
    if (isBlockedIp(host)) throw new SsrfBlockedError('Blocked IP address');
    return u;
  }
  // Hostname → resolve ALL addresses; every one must be public.
  let addrs: Array<{ address: string }>;
  try {
    addrs = await lookup(host, { all: true });
  } catch {
    throw new SsrfBlockedError('DNS resolution failed');
  }
  if (addrs.length === 0) throw new SsrfBlockedError('No DNS records');
  for (const a of addrs) {
    if (isBlockedIp(a.address)) throw new SsrfBlockedError('Hostname resolves to a non-public address');
  }
  return u;
}
