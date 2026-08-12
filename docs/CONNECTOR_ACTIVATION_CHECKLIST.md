# BIINA.ai — Connector Activation Checklist

Exact steps to activate a **real** external connector in production. Phase 10 ships
fully working on the **`mock` connector** (offline); real providers stay **DISABLED**
until a human completes the steps below. **Do not invent credentials** — every
value here is created by a human in a provider console. Companion:
`GOOGLE_CONNECTORS.md`, `OAUTH.md`, `CONNECTOR_SECURITY.md`.

## Completed in code (no action needed)

- Centralized OAuth flow (state binding, single-use, expiry, PKCE, session-match,
  explicit redirect URI) — `oauth.ts`.
- Credential encryption at rest (AES-256-GCM, key-versioned, KMS-ready) —
  `crypto.ts` / `credentials.ts`.
- Google Drive / Gmail / Calendar adapters (read-only), the mock adapter, the tool
  allowlist, `ConnectorService`, `ToolExecutionService`, connected search + citations.
- Registry seed: 5 connectors (`mock` **ENABLED**; `google-drive`, `gmail`,
  `google-calendar`, `slack` **DISABLED**) + per-tier plan entitlements.
- Admin → Connectors overview + enable/disable; `connector_usage_events` metering +
  `security_events` audit.

## Requires human action

### A. Set the credential encryption key (required for any connector)

1. Generate a stable 32-byte base64 key **once**:
   `openssl rand -base64 32`
2. Set `CONNECTOR_CREDENTIAL_ENCRYPTION_KEY` in the server environment.
3. **Back it up** in your secret manager. It must stay **stable across restarts** —
   losing/rotating it orphans every stored credential. Never commit it, never log it.

### B. Activate Google (Drive / Gmail / Calendar)

These share one Google OAuth app. In the **Google Cloud Console** (a human, in a
browser):

1. **Create a GCP project** (or pick an existing one).
2. **Configure the OAuth consent screen** — user type (Internal for a single
   Workspace org, else External), app name, support email, developer contact, and
   the app domain/privacy-policy/ToS links. Add your test users while unverified.
3. **Enable the required APIs** — **Google Drive API**, **Gmail API**, **Google
   Calendar API** (only the ones you intend to offer).
4. **Add the authorized redirect URI** exactly matching
   `CONNECTOR_OAUTH_REDIRECT_URI`, e.g.
   `https://app.biina.ai/api/connectors/callback`. It must match **character-for-
   character**.
5. **Create OAuth client credentials** (type: Web application) → copy the **Client
   ID** and **Client secret**.
6. **Select minimum, read-only scopes** on the consent screen:
   `drive.readonly`, `gmail.readonly`, `calendar.readonly`. Do **not** request
   write scopes in Phase 10.
7. **Set the server env** (never the browser, never git):
   - `GOOGLE_OAUTH_CLIENT_ID=…`
   - `GOOGLE_OAUTH_CLIENT_SECRET=…`
   - `CONNECTOR_OAUTH_REDIRECT_URI=https://app.biina.ai/api/connectors/callback`
   - (and `CONNECTOR_CREDENTIAL_ENCRYPTION_KEY` from step A)
8. **Enable the connector** in **Admin → Connectors** (Drive/Gmail/Calendar). The
   registry keeps them off until you do.

### C. Verify before trusting it

1. **Test a personal connection** — connect a Google account end-to-end; confirm an
   `ACTIVE` connection and an encrypted credential row (ciphertext, no plaintext).
2. **Test a search + read** — run a connected search and open a citation; confirm
   grounding + the permission re-check on open.
3. **Test token refresh** — confirm a refresh token was issued (`access_type=
   offline`) and that an expired access token recovers or flips the connection to
   `REAUTH_REQUIRED` (no silent failure).
4. **Test revocation** — disconnect; confirm the credential is **deleted**, the
   connection is `REVOKED`, and the audit row remains.
5. **Verify production consent config** — for External apps, complete Google
   verification for the requested scopes before general availability; confirm the
   consent screen shows the correct app identity and scopes.

### D. Organization connections (optional)

For org-scoped connectors, confirm only **org managers** can connect an
organization integration and that the connection is usable **only** within that
org's active workspace (Org A ≠ Org B). See `CONNECTOR_SECURITY.md`.

## Writes stay off

Leave `CONNECTOR_WRITE_ACTIONS_ENABLED=false`. Phase 10 is **read-only**; write
tools are registered but disabled and require the Phase 11 confirmation flow before
any activation. Do not enable write actions as part of connector activation.

## Other providers

`slack` is registered (adapter/registry readiness) but has no OAuth provider case
yet; Microsoft Graph / CRM / Notion are registry-level readiness only. Activating
any of them additionally requires adding its OAuth provider config and adapter — see
`CONNECTOR_ARCHITECTURE.md` ("Adding another connector").
