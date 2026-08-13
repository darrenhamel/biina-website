# BIINA.ai — SAML SSO

SAML 2.0 single sign-on for an organization. SAML is the second of BIINA's two
provider-independent enterprise identity protocols (the other is [`OIDC.md`](./OIDC.md));
both share the trust logic and injectable verifier in
[`ENTERPRISE_IDENTITY.md`](./ENTERPRISE_IDENTITY.md). Code:
[`identity.ts`](../apps/web/src/server/enterprise/identity.ts); schema
`organization_identity_providers` (`type = 'SAML'`).

## Gated OFF by default

SAML is behind `SAML_ENABLED` (default **false**). Even with an IdP configured,
`authenticateSso` refuses a SAML assertion with `saml_disabled` until the flag is on. This
is deliberate: SAML is enabled only once an organization is explicitly configured and the
real verifier is registered.

## SAML concepts BIINA models

- **IdP metadata** — the identity provider's metadata (entityId, SSO URL, signing
  certificate). Referenced by `metadataRef` (a secret/env reference name, not the value).
- **SP entityId** (`spEntityId`) — BIINA's service-provider identifier; the assertion's
  **audience** must match it.
- **ACS URL** (`acsUrl`) — the Assertion Consumer Service endpoint the IdP posts the
  signed assertion to.
- **IdP signing certificate** (`idpCertRef`) — used to verify the assertion signature.
  Stored as a reference; the certificate itself is provisioned out-of-band.
- **NameID** — the stable subject identifier; BIINA uses it as `subject` and records it as
  `scimExternalId` for correlation.
- **Attribute mappings** (`attributeMappings`) — maps IdP assertion attributes (email,
  display name, groups) to BIINA fields.
- **Issuer** — the IdP entityId; this is the **organization binding** — an assertion whose
  issuer does not match the org's configured IdP is rejected.

## Use a maintained library — never hand-rolled crypto

SAML signature validation, canonicalization, and XML handling are notoriously easy to get
wrong. BIINA does **not** hand-roll SAML crypto. As with OIDC, verification is delegated to
an **injectable verifier** (`setAssertionVerifier`): production registers a verifier backed
by a maintained SAML library that validates the signed assertion against `idpCertRef`,
checks `NotOnOrAfter`, audience (`spEntityId`), and the destination/ACS. The default
`structuralVerifier` validates issuer/audience/expiry/binding **but not the XML
signature**, and is for tests and the offline demonstration only.

## Trust checks & provisioning

Once the verifier returns a `VerifiedIdentity`, the same surrounding logic as OIDC applies:
issuer = organization binding, audience = `spEntityId`, expiry from `NotOnOrAfter`, domain
restriction, then JIT provisioning of a membership **bound to this org only**, returning a
`userId` for the normal `createSession`. See [`ENTERPRISE_IDENTITY.md`](./ENTERPRISE_IDENTITY.md).

## Endpoints & events

- `GET/POST /api/org/enterprise/identity` — configure the SAML provider (`identity.read` /
  `identity.manage`); requires `SAML_ENABLED` to authenticate.
- Events: `sso.login`, `sso.rejected` (metadata only). See
  [`ENTERPRISE_AUDIT.md`](./ENTERPRISE_AUDIT.md).

## Status

- Trust logic, org binding, attribute/NameID model, domain restriction, JIT provisioning —
  **IMPLEMENTED**, gated by `SAML_ENABLED`.
- Real signed-assertion verification via a maintained SAML library —
  **ARCHITECTURALLY READY** (register the verifier at activation).
- SSO enforcement + break-glass — **READINESS**.
