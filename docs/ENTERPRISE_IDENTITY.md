# BIINA.ai — Enterprise Identity

Provider-independent enterprise SSO. BIINA never couples to one IdP vendor: an
organization configures an **OIDC** or **SAML** provider, and BIINA owns the *trust
decisions* while a maintained crypto library owns *signature verification*. Code:
[`identity.ts`](../apps/web/src/server/enterprise/identity.ts); schema
`organization_identity_providers`. Protocol details:
[`OIDC.md`](./OIDC.md) · [`SAML.md`](./SAML.md). Automated provisioning:
[`SCIM.md`](./SCIM.md). Builds on [`AUTHENTICATION.md`](./AUTHENTICATION.md) and
[`ORGANIZATIONS.md`](./ORGANIZATIONS.md).

## First principle — an assertion is bound to one organization

BIINA never trusts an unverified identity claim, and never maps a user to a *different*
organization than the one whose IdP issued the assertion. `authenticateSso(organizationId,
input)` verifies the assertion **for that specific org**, applies the org's domain
restriction, provisions membership just-in-time **bound to that org only**, and returns a
BIINA `userId`. The caller then issues a session through the **normal** `createSession`
path — SSO does not invent its own session mechanism.

## Provider-independent by design

`identity.ts` defines an injectable `AssertionVerifier`:

- The **default `structuralVerifier`** validates the fields that define trust — issuer,
  audience, expiry, and (OIDC) nonce — plus **organization binding** and domain
  restriction. It is used by tests and the offline demonstration. **It does NOT perform
  cryptographic signature verification** and is not a production substitute.
- **Production registers a real verifier** via `setAssertionVerifier(v)` — an
  `openid-client`-backed OIDC verifier or a maintained SAML library. The surrounding trust
  logic (issuer/audience/expiry/nonce + org binding + domain restriction + JIT
  provisioning) does not change; only the crypto plugs in.

This is the same pattern used elsewhere in BIINA (injectable providers for search, DNS,
media): the security-relevant *decisions* live in reviewable server code; the vendor
integration is swappable.

## The trust checks

`authenticateSso` runs, in order:

1. Resolve the org's **enabled** IdP (`getEnabledIdp`). No enabled IdP → rejected. A SAML
   IdP additionally requires `SAML_ENABLED=true`, else `saml_disabled`.
2. **Verify** via the registered verifier — issuer must equal the org's configured issuer
   (OIDC issuer / SAML IdP entityId = **organization binding**); audience must match
   (OIDC `aud` = `clientIdRef`; SAML = `spEntityId`); the assertion must not be expired;
   an OIDC nonce must match the SP-generated nonce (replay protection).
3. **Domain restriction** — if the IdP config lists domains, the verified email's domain
   must be in the list, else `sso_domain` (logged as `sso.rejected`).
4. **JIT provisioning** — find-or-create the BIINA user by email, then ensure an
   `organization_members` row **for this org**, reactivating an inactive membership. The
   subject (NameID) is stored as `scimExternalId` for later correlation.

Every outcome emits a metadata-only security event (`sso.login`, `sso.rejected`) — never
tokens or assertions. See [`ENTERPRISE_AUDIT.md`](./ENTERPRISE_AUDIT.md).

## SSO enforcement (OPTIONAL / REQUIRED)

The IdP row carries `enforceSSO` and `allowPasswordFallback`:

- **OPTIONAL** (`enforceSSO=false`) — SSO is one way in; password login still works.
- **REQUIRED** (`enforceSSO=true`) — the organization intends SSO to be the only path.
  `allowPasswordFallback` governs whether a password login is still permitted as a
  documented exception.

**Break-glass** (an emergency non-SSO owner login when the IdP is unreachable) is
**readiness**: the columns exist to express intent, and an owner always retains full
control (OWNER is never lockable — see [`ENTERPRISE_RBAC.md`](./ENTERPRISE_RBAC.md)), but a
dedicated break-glass ceremony with its own audit trail is a later activation step.

## Managed vs personal accounts

`users.accountType` is `PERSONAL` (default) or organization-managed, with
`managedByOrganizationId`:

- A **PERSONAL** account is owned by the person. JIT provisioning through SSO/SCIM does
  **not** silently convert it — an existing personal account stays personal; managed
  conversion is an **explicit** action.
- An **organization-managed** account is provisioned/controlled by the enterprise IdP.

The invariant: **ownership never changes silently.** SSO can create a membership and (if
new) a user, but it never re-parents an existing personal account to an org.

## Offboarding

When a person leaves an organization:

- **Membership** is deactivated (`active=false`) — via SCIM
  (`deactivateUser`, see [`SCIM.md`](./SCIM.md)) or admin action. Access checks
  (`requireOrgPermission`, `memberIsActive`) then refuse; an inactive member has no org
  access.
- **Sessions** — the normal session lifecycle applies; enforced SSO re-auth windows
  (`ssoReauthMinutes`) shorten the window in which a stale session survives (enforcement of
  the session/idle/re-auth columns is readiness).
- **Org-owned data stays org-owned.** Conversations, knowledge, and audit created in the
  org context remain the org's, tenant-isolated as before.
- **Personal data is not transferred.** A deactivated user keeps their personal BIINA
  account and personal data; nothing personal moves to the org.

## Endpoints

- `GET/POST /api/org/enterprise/identity` — read/configure the org IdP (requires
  `identity.read` / `identity.manage`). Secrets are stored as **env/secret reference
  names** (`clientIdRef`, `clientSecretRef`, `metadataRef`, `idpCertRef`), never values.
- SSO callback wiring issues the session via `createSession` after `authenticateSso`.

See [`OIDC.md`](./OIDC.md) and [`SAML.md`](./SAML.md) for per-protocol configuration.
