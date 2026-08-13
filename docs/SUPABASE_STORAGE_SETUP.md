# BIINA.ai — Supabase Storage Setup (S3-compatible object storage)

Operator guide to provision **durable, private object storage** for Files/RAG using
Supabase Storage's **S3-compatible** endpoint. BIINA's storage adapter
(`apps/web/src/server/rag/storage.ts`) speaks S3 directly — **path-style addressing, AWS
SigV4 signed with `node:crypto`, no SDK.** Objects are **PRIVATE**; the browser never
receives credentials or a public URL. Local filesystem storage is **not durable** and is a
production BLOCKER, so this is a prerequisite for enabling Files/RAG.

> **Posture.** `S3_ACCESS_KEY_ID` and `S3_SECRET_ACCESS_KEY` are **secrets** — secrets
> manager / server `.env` only, **never committed, never pasted into chat or tickets,
> never logged.** The bucket is **private**: the app reads bytes server-side and enforces
> its own authorization. Never make the bucket public and never mint a public object URL.

Related: [`SUPABASE_PRODUCTION_SETUP.md`](./SUPABASE_PRODUCTION_SETUP.md) ·
[`FILES.md`](./FILES.md) · [`RAG_SECURITY.md`](./RAG_SECURITY.md) ·
[`MINIMUM_PRODUCTION_TOPOLOGY.md`](./MINIMUM_PRODUCTION_TOPOLOGY.md)

---

## What you'll end up with

Server-side environment values (both keys are secret):

```bash
FILE_STORAGE_PROVIDER=s3
S3_ENDPOINT=https://<project-ref>.supabase.co/storage/v1/s3
S3_BUCKET=<your-private-bucket>
S3_REGION=<your-supabase-project-region>
S3_ACCESS_KEY_ID=__set_out_of_band__
S3_SECRET_ACCESS_KEY=__set_out_of_band__
```

> `FILE_STORAGE_PROVIDER` also accepts `r2` and `supabase`; all three route to the same
> S3-compatible adapter. Use `s3` (or `supabase`) for Supabase Storage.

---

## 1. Use the project from the database setup

Storage lives in the **same Supabase project** you created in
[`SUPABASE_PRODUCTION_SETUP.md`](./SUPABASE_PRODUCTION_SETUP.md). No new billing decision
is required here beyond the project you already provisioned (HUMAN ACTION for
account/billing was completed there).

---

## 2. Create a PRIVATE Storage bucket

In the Supabase dashboard → **Storage → Create bucket**:

1. Name the bucket (e.g. `biina-files`) — record it as `S3_BUCKET`.
2. **Leave "Public bucket" OFF.** The bucket must be **private**. BIINA never serves
   objects to the browser directly; it reads them server-side and applies its own authz.
3. Create it.

---

## 3. Create S3 access keys

In the Supabase dashboard → **Storage → S3 Connection** (Storage settings):

1. Note the **S3 endpoint** — it has the form
   `https://<project-ref>.supabase.co/storage/v1/s3`. Record it as `S3_ENDPOINT`.
2. Note the **region** — this is your Supabase **project region**. Record it as
   `S3_REGION`. (The adapter defaults to `us-east-1` if unset, so set it explicitly to
   match your project.)
3. **Generate a new S3 access key.** Supabase shows an **access key id** and a **secret
   access key**.
   - `S3_ACCESS_KEY_ID` — the access key id (secret; store out of band).
   - `S3_SECRET_ACCESS_KEY` — the secret access key. **Shown once.** Copy it straight into
     the secrets manager; if you lose it, revoke and mint a new one rather than guessing.

> Both values are secrets. Do not commit them, do not paste them into a chat or ticket,
> do not log them.

---

## 4. Wire the app environment

Set on the app host / secrets manager (never commit; the two keys are secret):

```bash
FILE_STORAGE_PROVIDER=s3
S3_ENDPOINT=https://<project-ref>.supabase.co/storage/v1/s3
S3_BUCKET=<your-private-bucket>
S3_REGION=<your-supabase-project-region>
S3_ACCESS_KEY_ID=__set_out_of_band__
S3_SECRET_ACCESS_KEY=__set_out_of_band__
```

If any of `S3_ENDPOINT` / `S3_BUCKET` / `S3_ACCESS_KEY_ID` / `S3_SECRET_ACCESS_KEY` is
missing, the adapter throws at startup and `validate:production` marks it a **BLOCKER**.

Restart / redeploy the app so it reads the new environment.

---

## Private-object posture (do not weaken)

- The bucket is **private**. The adapter signs each request (SigV4) and reads bytes
  server-side; the browser never gets the credentials or a public URL.
- Storage keys are **opaque, sharded, server-generated** — never derived from a user
  filename. Uploaded bytes are stored and read as **opaque data**: never executed, never
  rendered as HTML, never served from a static path (see [`RAG_SECURITY.md`](./RAG_SECURITY.md)).
- Do **not** enable public access "to make previews easier." Previews go through the app.

---

## Verify

1. **Config completeness** — `validate:production` should report
   `FILE_STORAGE_PROVIDER … storage=s3 (S3-compatible configured)` (see below).

2. **Live storage round-trip (the real health check)** — the adapter's `health()` does a
   **signed `list-objects` (`max-keys=1`)** that proves endpoint + credentials without
   needing an object. The honest end-to-end confirmation is to exercise `put`/`get`
   through the app in **staging**:
   - Upload a file via the Files UI, then reload and confirm it opens (bytes round-trip
     through `put` then `get`).
   - Confirm the browser never receives a public storage URL (the file is fetched via the
     app origin, not `<project-ref>.supabase.co`).

3. **Bucket is private** — from the Supabase dashboard, confirm the bucket is **not**
   public.

---

## What Claude / CI can check

- `npm run validate:production -w apps/web` — a `local` provider is a production
  **BLOCKER**; an `s3`/`supabase`/`r2` provider with any of the four S3 vars missing is a
  **BLOCKER**; a complete config reports OK. It never prints a secret value.
- `npm run smoke:production -w apps/web` (with `BASE_URL=https://<app-host>`) — confirms
  the deployment is up and the health payload leaks no secret-shaped value.

Automation can run these read-only checks and can drive a staging file upload. It must
**not** create the Supabase account or add billing (HUMAN ACTION, done during database
setup).
