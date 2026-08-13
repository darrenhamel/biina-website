# BIINA.ai — Production Secret & Config Checklist (invite-only beta)

Every environment variable the beta needs on the single Hetzner box: whether it is a
**secret**, **where the value comes from** (which provider screen), and **where it goes**
(secret manager → the git-ignored `.env.production` on the box). Assemble the env file from
this table using [`.env.production.example`](../.env.production.example) as the field list;
deploy per [`HETZNER_DEPLOYMENT.md`](./HETZNER_DEPLOYMENT.md).

> **This document contains NO real values and never should.** Every entry below is a
> pointer to where the real value lives, not the value itself. See the closing rule.

Related: [`HETZNER_DEPLOYMENT.md`](./HETZNER_DEPLOYMENT.md) ·
[`HUMAN_LAUNCH_ACTIONS.md`](./HUMAN_LAUNCH_ACTIONS.md) ·
[`.env.production.example`](../.env.production.example) ·
[`OPERATIONS_RUNBOOK.md` §7 rotation](./OPERATIONS_RUNBOOK.md#7-credential--secret-rotation)

> **Legend — "Secret?"**
> **SECRET** = a key/password/connection-string/token. Lives **only** in the secret
> manager and the mode-`600` `.env.production` on the box. **Never** committed, logged,
> pasted in a PR/chat/ticket, or shown to the browser. · **config** = non-secret
> operational setting; safe to commit as a template default (the real value still lives in
> the env file, but disclosure is not a security event).

---

## 1. Secrets — SECRET, set out-of-band only

Generate the three app-internal secrets yourself (§3); the rest come from a provider screen.

| Var | Secret? | Where it comes from | Where it goes | Notes |
|---|---|---|---|---|
| `DATABASE_URL` | **SECRET** | Supabase → Project → Database → Connection string (URI, `sslmode=require`) | secret mgr → `.env.production` | Contains the DB password. Managed Postgres; validator rejects `localhost` in prod. |
| `AUTH_SECRET` | **SECRET** | You generate it (§3) | secret mgr → `.env.production` | ≥ 32 chars. Rotating invalidates sessions. |
| `CONNECTOR_CREDENTIAL_ENCRYPTION_KEY` | **SECRET** | You generate it (§3) | secret mgr → `.env.production` | ≥ 32 chars, AES-256-GCM key. **Back it up** — losing it makes connector creds unrecoverable ([backup runbook](./BACKUP_RESTORE_RUNBOOK.md)). Do not rotate blindly. |
| `S3_ACCESS_KEY_ID` | **SECRET** | Supabase → Storage → S3 access keys | secret mgr → `.env.production` | Server-side only; never reaches the browser. |
| `S3_SECRET_ACCESS_KEY` | **SECRET** | Supabase → Storage → S3 access keys | secret mgr → `.env.production` | Shown once at creation; store immediately. |
| `OPENAI_COMPATIBLE_API_KEY` | **SECRET** | RunPod → your endpoint's API key | secret mgr → `.env.production` | Auth for the inference endpoint. Server-side only, never logged. |
| `EMBEDDING_API_KEY` | **SECRET** | RunPod / embedding endpoint API key | secret mgr → `.env.production` | Only if the embedder is a **separate** endpoint; otherwise falls back to `OPENAI_COMPATIBLE_API_KEY`. |
| `RESEND_API_KEY` | **SECRET** | Resend → API Keys | secret mgr → `.env.production` | Required to send verification/reset/invite mail. |
| `WORKFLOW_TICK_SECRET` | **SECRET** | You generate it (§3) | secret mgr → `.env.production` | Shared secret for the scheduler sidecar's tick header. Unset ⇒ tick endpoint returns 503 (fails closed). |
| `STRIPE_SECRET_KEY` | **SECRET** | Stripe → Developers → API keys | secret mgr → `.env.production` | **Only if paid billing goes live later.** Stays unset/TEST for the beta. |
| `STRIPE_WEBHOOK_SECRET` | **SECRET** | Stripe → Developers → Webhooks → signing secret | secret mgr → `.env.production` | **Only if billing goes live later.** |

> OAuth connector client secrets (e.g. `GOOGLE_CLIENT_SECRET`) are also **SECRET** if you
> enable any write connectors — keep them off until configured (`CONNECTOR_WRITE_ACTIONS_ENABLED=false`
> by default). See [`CONNECTOR_RUNBOOK.md`](./CONNECTOR_RUNBOOK.md).

---

## 2. Non-secret configuration — config, safe to template

These select behavior/endpoints and hold no credential. The real value still goes in the
env file, but disclosure is not a security event.

| Var | Secret? | Where it comes from | Where it goes | Notes |
|---|---|---|---|---|
| `NODE_ENV` | config | Fixed | `.env.production` | `production`. |
| `BIINA_ENV` | config | Fixed | `.env.production` | `production` (log/metric attribution + fail-safe). |
| `NEXT_PUBLIC_APP_URL` | config | Your domain | `.env.production` | `https://app.biina.ai`. Validator rejects non-`https://`. Public by design. |
| `SIGNUP_MODE` | config | Decision | `.env.production` | `invite_only` for the beta. |
| `SIGNUP_ALLOWLIST` | config | Decision | `.env.production` | Comma/space-separated exact emails and/or `@domain`. Not a secret, but treat allowlisted addresses as private. |
| `FILE_STORAGE_PROVIDER` | config | Fixed | `.env.production` | `s3` (Supabase Storage via S3 adapter). |
| `S3_ENDPOINT` | config | Supabase → Storage → S3 endpoint | `.env.production` | e.g. `https://<project>.supabase.co/storage/v1/s3`. |
| `S3_BUCKET` | config | Supabase → Storage bucket name | `.env.production` | e.g. `biina-files` (private bucket). |
| `S3_REGION` | config | Supabase project region | `.env.production` | e.g. `us-east-1`. |
| `VECTOR_STORE` | config | Fixed | `.env.production` | `pgvector` (on the same Supabase Postgres) or the portable default. |
| `AI_DEFAULT_PROVIDER` | config | Fixed | `.env.production` | `openai-compatible`. `mock` is refused in prod. |
| `OPENAI_COMPATIBLE_BASE_URL` | config | RunPod → endpoint base URL | `.env.production` | The URL is not a secret, but keep it off client surfaces; the frontend never learns it. |
| `EMBEDDING_PROVIDER` | config | Fixed | `.env.production` | `openai-compatible`. Dev embedder is refused in prod. |
| `EMBEDDING_MODEL` | config | Endpoint model name | `.env.production` | Match the embedding endpoint. |
| `EMBEDDING_DIMENSIONS` | config | Endpoint model dimensions | `.env.production` | Must match the model; a mismatch corrupts retrieval. |
| `EMBEDDING_BASE_URL` | config | RunPod / embedding endpoint URL | `.env.production` | Only if the embedder is separate; else falls back to `OPENAI_COMPATIBLE_BASE_URL`. |
| `EMAIL_PROVIDER` | config | Fixed | `.env.production` | `resend`. Mock is refused in prod. |
| `EMAIL_FROM` | config | Your verified sender | `.env.production` | e.g. `"BIINA <no-reply@biina.ai>"`; domain must be verified in Resend. |
| `EMAIL_REPLY_TO` | config | Decision | `.env.production` | Optional, e.g. `support@biina.ai`. |
| `TICK_INTERVAL_SECONDS` | config | Decision | `.env.production` | Scheduler cadence; default `60`. |
| Feature flags (`ENTERPRISE_FEATURES_ENABLED`, `SAML_ENABLED`, `SCIM_ENABLED`, `SOVEREIGN_MODE_ENABLED`, `AGENT_WRITE_ACTIONS_ENABLED`, `WORKFLOW_SCHEDULED_WRITES_ENABLED`, `PUBLIC_LIBRARY_ENABLED`, `VOICE_MODE_ENABLED`, `BILLING_ENABLED`, `BILLING_LIVE_MODE`, …) | config | Decision (see [`V1_FEATURE_FLAGS.md`](./V1_FEATURE_FLAGS.md)) | `.env.production` | Conservative v1 defaults; keep write/public/live surfaces off for beta. |

---

## 3. Generation recipe — the three app-internal secrets

`AUTH_SECRET`, `CONNECTOR_CREDENTIAL_ENCRYPTION_KEY`, and `WORKFLOW_TICK_SECRET` are not
issued by any provider — you generate them. Use a CSPRNG; generate **distinct** values for
production and staging:

```bash
openssl rand -base64 48
```

Run it once per secret (three times total). Each yields a ~64-char base64 string,
comfortably above the ≥ 32-char minimum. Paste each result straight into your secret
manager, then into `.env.production` on the box — **do not** write them here, in a commit,
or in a chat.

> `CONNECTOR_CREDENTIAL_ENCRYPTION_KEY` is special: it decrypts the AES-256-GCM connector
> credentials in the database. **Store it in the secret manager AND keep a durable backup
> of it, separate from the DB dump.** If it is lost, every stored connector credential
> becomes permanently unrecoverable ([`BACKUP_RESTORE_RUNBOOK.md`](./BACKUP_RESTORE_RUNBOOK.md)).

---

## 4. Verify before you deploy

- [ ] Every **SECRET** row above has a real value in the secret manager and in the box's
      `.env.production` (mode `600`, git-ignored).
- [ ] No placeholder remains: `grep -c '__' .env.production` → `0`.
- [ ] `npm run validate:production -w apps/web` prints **0 BLOCKERS** (it never prints a
      secret value).
- [ ] `curl -s http://127.0.0.1:3000/api/health` → `200 {"status":"ok"}`.
- [ ] `BASE_URL=https://app.biina.ai npm run smoke:production -w apps/web` passes (health
      ok, security headers, signup gate 403, no secret-shaped strings in health).

---

## Do NOT store real values in this document.
