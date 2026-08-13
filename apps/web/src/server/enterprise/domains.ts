import { createHash, randomBytes } from 'node:crypto';
import { and, eq, ne } from 'drizzle-orm';
import { getDb } from '@/server/db';
import { verifiedDomains } from '@/server/db/schema';
import type { VerifiedDomain } from '@/server/db/schema';
import { AppError } from '@/lib/errors';
import { logSecurityEvent } from '@/server/auth/events';

/**
 * Domain verification (DNS TXT). Email domain alone is NEVER proof of ownership — an
 * org must prove control of the domain by publishing a TXT record containing a
 * cryptographically random token (only its HASH is stored). Two active organizations
 * cannot hold the same verified domain.
 */

const TXT_PREFIX = 'biina-domain-verification=';

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function normalizeDomain(domain: string): string {
  return domain.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
}

/** A DNS TXT verifier is injected so tests run offline. Real deployments resolve DNS. */
export interface DnsTxtResolver {
  resolveTxt(domain: string): Promise<string[]>;
}
let resolver: DnsTxtResolver | null = null;
export function setDnsTxtResolver(r: DnsTxtResolver | null): void {
  resolver = r;
}

/** Claim a domain for an org. Only an authorized org admin should reach this. Returns
 *  the plaintext token ONCE (for the DNS record) — only its hash is persisted. */
export async function claimDomain(organizationId: string, rawDomain: string, actorUserId: string): Promise<{ domain: VerifiedDomain; token: string; txtRecord: string }> {
  const domain = normalizeDomain(rawDomain);
  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(domain)) throw new AppError(400, 'Invalid domain.', 'bad_domain');
  const db = getDb();
  // Another org holding it in a non-revoked state blocks the claim.
  const [conflict] = await db.select().from(verifiedDomains).where(and(eq(verifiedDomains.domain, domain), ne(verifiedDomains.status, 'REVOKED'), ne(verifiedDomains.organizationId, organizationId))).limit(1);
  if (conflict) throw new AppError(409, 'This domain is already claimed by another organization.', 'domain_taken');

  const token = randomBytes(24).toString('base64url');
  const tokenHash = hashToken(token);
  const [existing] = await db.select().from(verifiedDomains).where(and(eq(verifiedDomains.domain, domain), eq(verifiedDomains.organizationId, organizationId))).limit(1);
  let row: VerifiedDomain;
  if (existing) {
    [row] = await db.update(verifiedDomains).set({ status: 'PENDING', verificationTokenHash: tokenHash, verifiedAt: null }).where(eq(verifiedDomains.id, existing.id)).returning();
  } else {
    [row] = await db.insert(verifiedDomains).values({ organizationId, domain, status: 'PENDING', verificationMethod: 'DNS_TXT', verificationTokenHash: tokenHash, createdByUserId: actorUserId }).returning();
  }
  await logSecurityEvent({ event: 'domain.claimed', userId: actorUserId, organizationId, metadata: { domain } });
  return { domain: row, token, txtRecord: `${TXT_PREFIX}${token}` };
}

/** Verify a claimed domain by checking its DNS TXT records for the token. */
export async function verifyDomain(organizationId: string, rawDomain: string, actorUserId: string): Promise<VerifiedDomain> {
  const domain = normalizeDomain(rawDomain);
  const db = getDb();
  const [row] = await db.select().from(verifiedDomains).where(and(eq(verifiedDomains.domain, domain), eq(verifiedDomains.organizationId, organizationId))).limit(1);
  if (!row) throw new AppError(404, 'Domain claim not found.', 'no_claim');
  if (row.status === 'VERIFIED') return row;
  if (!resolver) throw new AppError(503, 'DNS verification is not available in this environment.', 'no_resolver');

  const records = await resolver.resolveTxt(domain).catch(() => [] as string[]);
  const match = records.some((r) => r.startsWith(TXT_PREFIX) && hashToken(r.slice(TXT_PREFIX.length)) === row.verificationTokenHash);
  const [updated] = await db.update(verifiedDomains).set({ status: match ? 'VERIFIED' : 'FAILED', verifiedAt: match ? new Date() : null }).where(eq(verifiedDomains.id, row.id)).returning();
  await logSecurityEvent({ event: match ? 'domain.verified' : 'domain.verification_failed', userId: actorUserId, organizationId, metadata: { domain } });
  return updated;
}

export async function listDomains(organizationId: string): Promise<VerifiedDomain[]> {
  return getDb().select().from(verifiedDomains).where(eq(verifiedDomains.organizationId, organizationId));
}

export async function revokeDomain(organizationId: string, domainId: string, actorUserId: string): Promise<void> {
  await getDb().update(verifiedDomains).set({ status: 'REVOKED', verifiedAt: null }).where(and(eq(verifiedDomains.id, domainId), eq(verifiedDomains.organizationId, organizationId)));
  await logSecurityEvent({ event: 'domain.revoked', userId: actorUserId, organizationId, metadata: { domainId } });
}

/** Is a domain VERIFIED for an org? (used to gate SSO discovery/provisioning). */
export async function isDomainVerified(organizationId: string, rawDomain: string): Promise<boolean> {
  const domain = normalizeDomain(rawDomain);
  const [row] = await getDb().select({ status: verifiedDomains.status }).from(verifiedDomains).where(and(eq(verifiedDomains.domain, domain), eq(verifiedDomains.organizationId, organizationId))).limit(1);
  return row?.status === 'VERIFIED';
}
