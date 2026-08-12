# BIINA.ai — Connector OAuth

The **centralized OAuth lifecycle** for external connectors — one flow for every
provider, with no per-connector duplication. State is cryptographically random,
single-use, expiring, and **bound to the initiating user**; the callback
re-validates everything and never trusts arbitrary redirect params. Code:
`apps/web/src/server/connectors/oauth.ts`. Companion: `CONNECTOR_SECURITY.md`,
`GOOGLE_CONNECTORS.md`, `CONNECTOR_ACTIVATION_CHECKLIST.md`.

## Lifecycle at a glance

```
beginOAuth  → validate connector + type + org-manager → mint state row (PKCE)
            → build provider authorization URL (explicit redirect_uri)
[user consents at the provider]
completeOAuth → single-use-consume state → session-must-match-state
            → exchange code → verify account → ACTIVE connection + encrypted credential
```

A `mock` provider completes the whole flow **offline** (no network, no key), so the
connect → search → read → ground → cite path is fully exercisable in tests/demo.

## `beginOAuth` — authorization

Before any redirect, the server checks:

- the **connector is enabled** (`connector_definitions.enabled`);
- the requested **connection type is supported** (`supportsPersonal` /
  `supportsOrganization`);
- for an **ORGANIZATION** connection, the caller is an **org manager** of the
  active workspace (`resolveOrgContextById` + `isOrgManager`).

It then writes a single-use `oauth_states` row bound to `{ user, connectorSlug,
connectionType, organizationId }` with a **10-minute expiry** and, where the
provider supports it, a **PKCE** code verifier. The provider authorization URL is
built with `response_type=code`, the connector's minimal scopes, `access_type=
offline`, `prompt=consent`, and — where PKCE applies — an `S256` code challenge.

## Explicit redirect URI — no open redirect

The `redirect_uri` is **explicitly configured** (`CONNECTOR_OAUTH_REDIRECT_URI`,
falling back to `${appBaseUrl}/api/connectors/callback`) — never derived from a
request parameter. There is no way for a caller to point the callback anywhere
else, which closes the open-redirect / token-interception vector.

## State binding, single-use & expiry

The `state` value is 24 random bytes (`base64url`). It is:

- **Bound** to the user/connector/type/org that created it;
- **Single-use** — `completeOAuth` flips `usedAt` in an **atomic conditional
  UPDATE** (`state = ? AND usedAt IS NULL AND expiresAt > now`), so a replayed or
  concurrent callback finds nothing to consume;
- **Expiring** — unused states age out after the TTL.

## `completeOAuth` — callback validation

The callback runs, in order:

1. **Atomic single-use consume** of the state (invalid/expired/used → `400`).
2. **Session match** — the callback's authenticated session **must equal** the
   state's user, else `403`. This defends **OAuth CSRF / account-linking**: an
   attacker cannot graft their consent onto a victim's session.
3. **Code exchange** — POST to the provider token URL with the PKCE verifier
   (mock returns canned tokens); a failed exchange is a redacted `400`.
4. **Account verification** — the adapter's `testConnection` confirms the token
   actually resolves an account before anything is persisted.
5. **Persist** — create an **ACTIVE** `connections` row (personal XOR org,
   granted scopes/capabilities) and save the **encrypted** credential; write a
   `connector.connected` security event.

## Token storage

Tokens never touch the `connections` row. They are encrypted (AES-256-GCM) and
stored only in `connector_credentials` via `saveCredential` — the one write path.
See `CONNECTOR_SECURITY.md`.

## Refresh readiness & race-safety

The credential model carries `refreshToken` / `expiresAt`, and Google requests
`access_type=offline` so a refresh token is issued. A refresh routine slots in
behind `loadCredential`/`saveCredential`; because the credential row is **unique
per connection** and updated by `onConflictDoUpdate`, a refresh write is
last-writer-wins safe. On a `401`/expiry the connection is flipped to
`REAUTH_REQUIRED` and the user is prompted to reconnect (no silent failure).

## Revocation

`revokeConnection` (manager-only) **deletes the credential**, marks the connection
`REVOKED`, and logs a `connector.revoked` event — keeping the audit trail while
removing all token material. A best-effort provider-side revocation hook is left
for each adapter.

## Scope minimization & escalation

A connector requests the **minimum read-only scopes** it needs (see
`GOOGLE_CONNECTORS.md`). Granting a broader capability later means re-consent with
the added scope — connections record their `grantedScopes`, and a capability the
grant doesn't include is refused by `ConnectorService` even if a tool asks for it.

## Connection statuses

| Status | Meaning |
|---|---|
| `PENDING` | connect started, not yet completed |
| `ACTIVE` | usable |
| `EXPIRED` | token lifetime elapsed |
| `REAUTH_REQUIRED` | provider rejected the token — reconnect needed |
| `REVOKED` | disconnected; credential deleted |
| `ERROR` | last operation failed |
| `DISABLED` | administratively turned off |

Only an **ACTIVE** connection is used for retrieval; anything else is skipped.
