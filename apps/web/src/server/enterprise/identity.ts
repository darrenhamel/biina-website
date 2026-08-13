import { and, eq } from 'drizzle-orm';
import { getDb } from '@/server/db';
import { organizationIdentityProviders, organizationMembers, users, profiles } from '@/server/db/schema';
import type { OrganizationIdentityProvider } from '@/server/db/schema';
import { AppError } from '@/lib/errors';
import { logSecurityEvent } from '@/server/auth/events';
import { samlEnabled } from './config';

/**
 * Provider-independent enterprise identity (OIDC / SAML). BIINA never trusts an
 * unverified identity claim: an assertion must be validated AND bound to the exact
 * organization whose IdP issued it. Cryptographic verification (OIDC token signature,
 * SAML signed assertion) is delegated to maintained libraries at activation; this
 * module owns the trust decisions that surround it — issuer/audience/expiry/nonce +
 * ORGANIZATION BINDING + domain restriction — and provisions the session user.
 *
 * A verifier is injected so tests (and real libraries) plug in without changing the
 * trust logic. The default verifier is a strict structural check used for tests and
 * the offline demonstration — it is NOT a substitute for real crypto in production.
 */

export interface VerifiedIdentity {
  subject: string; // stable IdP subject / NameID
  email: string;
  displayName?: string;
  issuer: string; // OIDC issuer / SAML IdP entityId
  audience?: string; // OIDC aud / SAML SP entityId
  notAfterMs?: number; // token exp / assertion NotOnOrAfter
  nonce?: string;
  attributes?: Record<string, string>;
}

export interface AssertionInput {
  /** The raw token/assertion (opaque to the trust logic — the verifier parses it). */
  raw: unknown;
  /** OIDC only — the nonce the SP generated for this flow. */
  expectedNonce?: string;
}

/** A pluggable verifier. Real deployments register an openid-client / SAML verifier. */
export interface AssertionVerifier {
  verify(idp: OrganizationIdentityProvider, input: AssertionInput): Promise<VerifiedIdentity>;
}

/**
 * Default STRUCTURAL verifier (tests + offline demo). It validates the fields that
 * define trust — issuer, audience, expiry, nonce — against the configured IdP, but
 * it does NOT perform cryptographic signature verification. Production MUST register
 * a real verifier via setAssertionVerifier().
 */
const structuralVerifier: AssertionVerifier = {
  async verify(idp, input) {
    const a = input.raw as Partial<VerifiedIdentity> & { signatureValid?: boolean };
    if (!a || typeof a !== 'object') throw new AppError(401, 'Malformed assertion.', 'sso_malformed');
    if (!a.subject || !a.email || !a.issuer) throw new AppError(401, 'Assertion missing required claims.', 'sso_incomplete');
    // ORGANIZATION BINDING: the issuer MUST match the org's configured IdP.
    const expectedIssuer = idp.type === 'OIDC' ? idp.issuer : idp.issuer; // SAML uses issuer=IdP entityId
    if (!expectedIssuer || a.issuer !== expectedIssuer) throw new AppError(401, 'Assertion issuer is not bound to this organization.', 'sso_issuer_mismatch');
    // Audience binding (OIDC aud / SAML SP entityId).
    const expectedAudience = idp.type === 'OIDC' ? idp.clientIdRef : idp.spEntityId;
    if (expectedAudience && a.audience && a.audience !== expectedAudience) throw new AppError(401, 'Assertion audience mismatch.', 'sso_audience');
    // Expiry.
    if (a.notAfterMs != null && a.notAfterMs < nowMs()) throw new AppError(401, 'Assertion has expired.', 'sso_expired');
    // OIDC nonce replay protection.
    if (idp.type === 'OIDC' && input.expectedNonce != null && a.nonce !== input.expectedNonce) throw new AppError(401, 'Nonce mismatch.', 'sso_nonce');
    return { subject: a.subject, email: a.email.toLowerCase(), displayName: a.displayName, issuer: a.issuer, audience: a.audience, notAfterMs: a.notAfterMs, nonce: a.nonce, attributes: a.attributes ?? {} };
  },
};

let verifier: AssertionVerifier = structuralVerifier;
export function setAssertionVerifier(v: AssertionVerifier | null): void {
  verifier = v ?? structuralVerifier;
}

// Testable clock (Date.now() is unavailable in workflow scripts but fine in the app/tests).
function nowMs(): number {
  return new Date().getTime();
}

export async function getEnabledIdp(organizationId: string, type?: 'OIDC' | 'SAML'): Promise<OrganizationIdentityProvider | null> {
  const rows = await getDb().select().from(organizationIdentityProviders).where(and(eq(organizationIdentityProviders.organizationId, organizationId), eq(organizationIdentityProviders.enabled, true)));
  const list = type ? rows.filter((r) => r.type === type) : rows;
  return list[0] ?? null;
}

/**
 * Authenticate an SSO assertion for a SPECIFIC organization and provision the
 * membership (JIT). Returns the BIINA user id — the caller then issues a session via
 * the normal createSession path. Never maps a user to a different organization than
 * the one whose IdP issued the assertion.
 */
export async function authenticateSso(organizationId: string, input: AssertionInput): Promise<{ userId: string; provisioned: boolean }> {
  const idp = await getEnabledIdp(organizationId);
  if (!idp) throw new AppError(400, 'No enabled identity provider for this organization.', 'sso_no_idp');
  if (idp.type === 'SAML' && !samlEnabled()) throw new AppError(403, 'SAML is not enabled.', 'saml_disabled');

  const identity = await verifier.verify(idp, input);

  // Domain restriction: the email domain must be permitted by the IdP config.
  const domainList = idp.domainRestriction ?? [];
  if (domainList.length) {
    const domain = identity.email.split('@')[1] ?? '';
    if (!domainList.includes(domain)) {
      await logSecurityEvent({ event: 'sso.rejected', organizationId, metadata: { reason: 'domain_restriction', domain } });
      throw new AppError(403, 'Email domain is not permitted for this organization.', 'sso_domain');
    }
  }

  const db = getDb();
  // Find or create the BIINA account (JIT). Account ownership is NOT changed here —
  // an existing personal account stays personal; managed conversion is explicit.
  let [user] = await db.select({ id: users.id }).from(users).where(eq(users.email, identity.email)).limit(1);
  let provisioned = false;
  if (!user) {
    [user] = await db
      .insert(users)
      .values({ email: identity.email, passwordHash: 'sso:no-password', role: 'USER', plan: 'FREE', status: 'ACTIVE', emailVerified: true })
      .returning({ id: users.id });
    await db.insert(profiles).values({ userId: user.id, displayName: identity.displayName ?? identity.email });
    provisioned = true;
  }

  // Ensure org membership (bound to THIS org only).
  const [existing] = await db.select().from(organizationMembers).where(and(eq(organizationMembers.organizationId, organizationId), eq(organizationMembers.userId, user.id))).limit(1);
  if (!existing) {
    await db.insert(organizationMembers).values({ organizationId, userId: user.id, role: 'MEMBER', managedByScim: false, scimExternalId: identity.subject, active: true });
  } else if (!existing.active) {
    await db.update(organizationMembers).set({ active: true, updatedAt: new Date() }).where(eq(organizationMembers.id, existing.id));
  }

  await logSecurityEvent({ event: 'sso.login', userId: user.id, organizationId, metadata: { idpType: idp.type, provisioned } });
  return { userId: user.id, provisioned };
}
