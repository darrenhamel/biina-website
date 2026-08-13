# BIINA.ai — Connector Runbook

Operating third-party connectors (OAuth-based integrations). Every procedure
follows **detect → act → verify**.

On-call: `<ops-oncall>` · Connector owner: `<connectors-owner>`

See also: `docs/CONNECTOR_ARCHITECTURE.md`, `docs/CONNECTOR_SECURITY.md`,
`docs/OAUTH.md`, `docs/GOOGLE_CONNECTORS.md`.

---

## 0. How credentials are stored (read first)

Connector credentials (OAuth access/refresh tokens) are **AES-256-GCM encrypted
at rest** (`src/server/connectors/crypto.ts`):

- Key from `CONNECTOR_CREDENTIAL_ENCRYPTION_KEY` (**CRITICAL**, ≥ 32 chars). A
  32-byte hex/base64 value is used directly; otherwise it is derived via `scrypt`.
- Per-record random 12-byte IV; the auth tag is stored with the ciphertext.
- The key **never reaches the browser and is never logged**.
- OAuth uses `state` + PKCE (`usesPkce`) where the provider supports it.

> **Consequence:** rotating `CONNECTOR_CREDENTIAL_ENCRYPTION_KEY` without
> re-encrypting makes all stored connector credentials undecryptable. See §5.

---

## 1. OAuth connection failure (user can't connect)

**Detect** — users fail to complete the OAuth flow; callback errors; `state`
mismatch errors.

**Act**
1. Verify the provider app config: client id/secret, **redirect/callback URL**
   matches `NEXT_PUBLIC_APP_URL` exactly (https), and requested scopes are still
   valid at the provider.
2. Check clock skew / `state` handling — a mismatched or expired `state` aborts
   the flow by design (CSRF protection). Have the user retry from a fresh start.
3. Confirm the provider is not itself down (Section 3).

**Verify** — a fresh connect completes and a credential row is stored (encrypted);
a read call through the connector succeeds.

---

## 2. Revoked / expired token

**Detect** — connector calls return `401`/`invalid_grant`; the user revoked access
at the provider, or the refresh token expired.

**Act**
1. Attempt a refresh (the connector refreshes access tokens using the stored
   refresh token). If refresh returns `invalid_grant`, the grant is gone.
2. Mark the connection as **needs reconnect** and prompt the user to re-authorize.
   Do not retry indefinitely against a dead grant.
3. Ensure any agent/workflow depending on this connector degrades cleanly (a
   revoked connector should surface a clear "reconnect" state, not silent failures).

**Verify** — after the user reconnects, a read call succeeds and dependent
automations resume.

---

## 3. Connector provider outage

**Detect** — provider-wide `5xx`/timeouts across all users of one connector.

**Act**
1. Confirm it is the provider (status page) vs BIINA.
2. If automations are hammering a failing provider, disable that tool in
   automations: `AGENT_DISABLED_TOOLS="<tool.id>"` and/or
   `WORKFLOW_DISABLED_TOOLS="<tool.id>"` (`OPERATIONS_RUNBOOK.md` §8), then restart.
3. Let interactive use fail with a clear error; avoid aggressive retry storms.

**Verify** — once the provider recovers, remove the tool from the disabled lists
and confirm calls succeed.

---

## 4. Scope change (provider changes/expands scopes)

**Detect** — provider deprecates a scope or requires re-consent; calls that used
to work now `403`.

**Act**
1. Update the connector's requested scopes to the new set.
2. Existing users must **re-consent** — mark connections needing reconnect and
   prompt. New scopes cannot be granted to old tokens silently.
3. Communicate the required reconnect to affected users/orgs.

**Verify** — reconnected users have the new scopes; previously-`403` calls succeed.

---

## 5. Credential re-encryption / key rotation

> High-risk. Plan a maintenance window. Do a DB backup first
> (`BACKUP_RESTORE_RUNBOOK.md`).

**Detect** — scheduled rotation, or `CONNECTOR_CREDENTIAL_ENCRYPTION_KEY`
suspected compromised (`SECURITY_RUNBOOK.md`).

**Act (re-encrypt, do NOT hot-swap the key blindly)**
1. Keep the **current** key available as the "old" key.
2. Generate the **new** key (≥ 32 chars, high-entropy; store in the secret manager,
   never in git).
3. Run a one-time re-encryption pass (operator task): for each credential, decrypt
   with the **old** key and re-encrypt with the **new** key. *(This
   migration/rotation utility is an operator task and is **REQUIRES INFRA/HUMAN
   ACTION** — it is not a committed runtime endpoint.)*
4. Swap `CONNECTOR_CREDENTIAL_ENCRYPTION_KEY` to the new value; redeploy/restart.

**If the key is compromised and you cannot re-encrypt cleanly:** treat stored
tokens as burned — force-revoke/clear them and require all users to reconnect.
Notify per `SECURITY_RUNBOOK.md` (no legal breach-notification claims here).

**Verify** — connectors decrypt and refresh normally under the new key; no
decrypt errors in logs; `encryptionConfigured` reports true.

---

## Do-not-do
- Never log decrypted tokens or the encryption key.
- Never rotate `CONNECTOR_CREDENTIAL_ENCRYPTION_KEY` without re-encrypting or
  accepting a full reconnect of every connection.
- Never bypass `state`/PKCE checks to "make OAuth work."
