# BIINA.ai — OIDC SSO

OpenID Connect single sign-on for an organization. OIDC is one of BIINA's two
provider-independent enterprise identity protocols (the other is [`SAML.md`](./SAML.md));
both share the trust logic and the injectable verifier described in
[`ENTERPRISE_IDENTITY.md`](./ENTERPRISE_IDENTITY.md). Code:
[`identity.ts`](../apps/web/src/server/enterprise/identity.ts); schema
`organization_identity_providers` (`type = 'OIDC'`).

## What the org configures

Stored on the IdP row (secrets are **reference names**, never values):

- `issuer` — the OIDC issuer URL. This is the **organization binding**: an assertion whose
  issuer does not match is rejected.
- `clientIdRef` — env/secret ref for the client id; also the expected **audience** (`aud`).
- `clientSecretRef` — env/secret ref for the client secret. The value is set out-of-band in
  the secret store and **never committed**.
- `domainRestriction` — optional list of permitted email domains.
- `enforceSSO`, `allowPasswordFallback` — enforcement posture (OPTIONAL / REQUIRED).

## The trust checks

At authentication, the verifier + `authenticateSso` establish, in order:

1. **Issuer** — the token `iss` must equal the configured `issuer` (org binding).
2. **State** — the SP-generated `state` is validated at the callback (CSRF protection on
   the authorization-code round trip).
3. **Nonce** — the `nonce` in the ID token must match the nonce the SP generated for this
   flow (`expectedNonce`) — replay protection.
4. **Redirect URI** — the callback must match a registered redirect URI (enforced at the
   provider + callback wiring).
5. **Signature** — the ID token signature is verified against the provider JWKS. In
   production this is done by the registered `openid-client` verifier; the default
   structural verifier does **not** check signatures and is for tests/offline demo only.
6. **Audience** — `aud` must match `clientIdRef`.
7. **Expiry** — the token must not be past `exp` (`notAfterMs`).
8. **Organization binding** — re-asserted: the assertion is only ever accepted for the org
   whose IdP issued it, and a user is never mapped to a different org.

## Real-library integration at activation

The production integration registers an `openid-client`-backed verifier via
`setAssertionVerifier(v)`. That verifier performs discovery, JWKS signature verification,
and `state`/`nonce`/`redirect` handling; it then returns a `VerifiedIdentity`
(`subject`, `email`, `issuer`, `audience`, `notAfterMs`, `nonce`, attributes). The
surrounding domain restriction + JIT provisioning + org binding logic is unchanged. **Do
not hand-roll token verification** — use the maintained library.

## JIT provisioning

On a verified assertion, `authenticateSso`:

- finds or creates the BIINA user by verified email (a new user is created with an
  unusable password sentinel and `emailVerified: true`);
- ensures an `organization_members` row **bound to this org only** (subject stored as
  `scimExternalId`), reactivating an inactive membership;
- returns `{ userId, provisioned }`. The caller issues the session via the normal
  `createSession`.

An existing **personal** account is linked, never silently converted to managed — see the
managed-vs-personal model in [`ENTERPRISE_IDENTITY.md`](./ENTERPRISE_IDENTITY.md).

## Endpoints & events

- `GET/POST /api/org/enterprise/identity` — configure the OIDC provider (`identity.read` /
  `identity.manage`).
- Events: `sso.login`, `sso.rejected` (metadata only — never tokens). See
  [`ENTERPRISE_AUDIT.md`](./ENTERPRISE_AUDIT.md).

## Status

- Trust logic, org binding, domain restriction, JIT provisioning — **IMPLEMENTED**.
- Real signature/JWKS verification via `openid-client` — **ARCHITECTURALLY READY**
  (register the verifier at activation).
- SSO enforcement + re-auth window enforcement, break-glass — **READINESS**.
