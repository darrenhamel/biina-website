# BIINA.ai — Google Connectors

The **Google Drive**, **Gmail**, and **Google Calendar** connectors — three
adapters over a **shared Google OAuth** app. All are **read-only** in Phase 10.
Code: `apps/web/src/server/connectors/adapters.ts` (adapters) +
`oauth.ts` (the shared `google` provider). To turn them on, follow
`CONNECTOR_ACTIVATION_CHECKLIST.md`. Companion: `CONNECTOR_ARCHITECTURE.md`,
`OAUTH.md`, `CONNECTOR_SECURITY.md`.

## Shared Google OAuth

All three connectors use **one** Google OAuth client
(`GOOGLE_OAUTH_CLIENT_ID` / `GOOGLE_OAUTH_CLIENT_SECRET`) via the centralized
`google` provider in `oauth.ts`:

- authorization at `accounts.google.com/o/oauth2/v2/auth`, token exchange at
  `oauth2.googleapis.com/token`;
- **PKCE `S256`**, `access_type=offline` + `prompt=consent` so a **refresh token**
  is issued;
- an **explicitly configured** redirect URI (`CONNECTOR_OAUTH_REDIRECT_URI`) — never
  request-derived.

Because they share the app, the redirect URI and consent screen are configured
**once**. Each connector requests only the **incremental scopes** it needs — the
Drive connector never asks for mail scopes, and vice-versa (scope minimization).

## Read capabilities

| Connector | Slug | Capabilities | Reads |
|---|---|---|---|
| Google Drive | `google-drive` | `SEARCH` `LIST` `READ` `DOWNLOAD` | file search + export text |
| Gmail | `gmail` | `SEARCH` `READ` | message search + message body |
| Google Calendar | `google-calendar` | `LIST` (`calendar.list`) | list/search events |

Recommended **read-only** scopes: Drive `drive.readonly`, Gmail
`gmail.readonly`, Calendar `calendar.readonly`.

## Google Drive adapter

- `testConnection` verifies the token via the OpenID `userinfo` endpoint.
- `search` queries `drive/v3/files` with `fullText contains …` (excludes trashed),
  bounded `pageSize`, returning normalized `CONNECTED_FILE` resources (id, name,
  mimeType, `webViewLink`, modified time).
- `read` **exports** a file to `text/plain` for grounding text.
- **Document-pipeline reuse:** a Drive file's exported text flows through the same
  Phase 8 extraction/chunking/token-budget path as an uploaded document, so
  connected files and uploaded files ground identically. Fetching a file's raw
  bytes into the full upload pipeline is a prepared seam (see `CONNECTED_SEARCH.md`).

## Gmail adapter

- `testConnection` reads the `users/me/profile` endpoint for the account address.
- `search` queries `users/me/messages` (Gmail's own query syntax), returning
  normalized `CONNECTED_EMAIL` resources.
- `read` fetches a message (`format=full`) and returns its subject + snippet as
  grounding text.

## Google Calendar

Registered as `google-calendar` with a `calendar.list` read tool. Event
list/search is normalized to `CONNECTED_EVENT` resources; the adapter shares the
Google OAuth app and read-only posture.

## What's read-only

**Everything.** Drive/Gmail/Calendar expose only `SEARCH`/`LIST`/`READ`/`DOWNLOAD`.
Write tools that touch Google (`gmail.send`, `calendar.create`, `drive.delete`) are
**registered and risk-classified but DISABLED** — they never execute in Phase 10
(see `TOOL_EXECUTION.md`, `CONNECTOR_SECURITY.md`).

## Honest status

- The adapters are **fetch-based and correct in shape**, but **not exercised**
  against live Google — this environment has **no Google credentials**. They run
  the real Google REST endpoints once real OAuth is configured.
- The **`mock` connector** is the exercisable default: the full connect → search →
  read → ground → cite path runs **offline**, so the pipeline, isolation, injection
  defense, quotas, and citations are all testable without Google.
- Google connectors stay **DISABLED** in the registry until
  `GOOGLE_OAUTH_CLIENT_ID/SECRET` are set and an admin enables them.

## Activation pointer

Do **not** invent credentials. The exact GCP + admin steps — create the project,
configure the consent screen, add the redirect URI, enable the Drive/Gmail/Calendar
APIs, create the OAuth client, set the env vars, enable in Admin → Connectors, and
test connect/refresh/revoke — live in `CONNECTOR_ACTIVATION_CHECKLIST.md`.
