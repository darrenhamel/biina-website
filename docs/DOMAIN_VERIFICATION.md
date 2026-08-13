# BIINA.ai — Domain Verification

Proof that an organization controls a domain, via a **DNS TXT** record. Domain
verification gates trustworthy SSO discovery and provisioning: an email domain by itself is
**never** proof of ownership. Code:
[`domains.ts`](../apps/web/src/server/enterprise/domains.ts); schema `verified_domains`.
Related: [`ENTERPRISE_IDENTITY.md`](./ENTERPRISE_IDENTITY.md).

## Why email domain ≠ ownership

Anyone can *claim* `@example.gov`. Proving control requires publishing a value only the
domain's DNS operator can set. So BIINA requires a DNS TXT record before treating a domain
as owned by an org.

## The DNS TXT flow

1. **Claim** (`claimDomain`) — an authorized org admin claims a normalized domain. BIINA
   generates a **cryptographically random** token, stores **only its SHA-256 hash**, and
   returns the plaintext **once** as a TXT record to publish:
   `biina-domain-verification=<token>`.
2. **Publish** — the org adds that TXT record at their DNS provider.
3. **Verify** (`verifyDomain`) — BIINA resolves the domain's TXT records (via an injectable
   `DnsTxtResolver`) and hashes each candidate; a match flips status to `VERIFIED`, a miss
   to `FAILED`. The resolver is injected so tests run offline; production resolves real DNS.

## Statuses

`domain_status` enum: `PENDING` → `VERIFIED` / `FAILED`, and `REVOKED`. `revokeDomain`
sets `REVOKED` and clears `verifiedAt`. `isDomainVerified` is the gate other surfaces call.

## One org per domain

A `uniqueIndex` on `domain WHERE status <> 'REVOKED'` enforces that **only one
organization** may hold a given domain in a non-revoked state. `claimDomain` also checks
for a conflicting non-revoked claim by another org and refuses with `domain_taken` (409). A
revoked claim frees the domain for another org.

## Token hashing

The verification token is treated like a secret: only its hash is persisted, the plaintext
is shown once, and the TXT match re-hashes the published value to compare. There is no way
to read a stored token back.

## Discovery readiness

Using a verified domain to **auto-discover** the right org/IdP at login (so a user typing
`name@example.gov` is routed to that org's SSO) is **readiness** — the verification
substrate exists; the login-time discovery UX is a later activation step. Verification also
underpins JIT provisioning trust in [`ENTERPRISE_IDENTITY.md`](./ENTERPRISE_IDENTITY.md).

## Endpoints & events

- `GET/POST /api/org/enterprise/domains` — list/claim (`identity.read` / `identity.manage`).
- `POST /api/org/enterprise/domains/verify` — verify a claim (`identity.manage`).
- Events: `domain.claimed`, `domain.verified`, `domain.verification_failed`,
  `domain.revoked` (metadata only). See [`ENTERPRISE_AUDIT.md`](./ENTERPRISE_AUDIT.md).

## Status

- DNS TXT claim/verify/revoke, hashed token, one-org-per-domain — **IMPLEMENTED**
  (injectable resolver).
- Login-time domain → org/IdP discovery — **READINESS**.
