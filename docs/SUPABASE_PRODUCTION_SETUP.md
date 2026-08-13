# BIINA.ai — Supabase Production Setup (Postgres + pgvector)

Operator guide to stand up the **production database** for the invite-only beta on
[Supabase](https://supabase.com): a managed Postgres 16 instance with the `pgvector`
extension, migrated, seeded with production-safe system data, and with a first admin
bootstrapped. Follow the steps top-to-bottom; each ends verifiable.

> **Posture.** `DATABASE_URL` is a **secret** (it embeds the DB password). It goes only
> into the secrets manager / server `.env` — **never committed, never pasted into chat or
> tickets, never logged.** The production config validator **refuses a localhost DB** in
> production, so this must be a real managed instance. Migrations are **additive-only**
> (0000–0015); the production seed loads **plans + deployment profiles only** — no test
> users, no mock data.

Related: [`MINIMUM_PRODUCTION_TOPOLOGY.md`](./MINIMUM_PRODUCTION_TOPOLOGY.md) ·
[`SUPABASE_STORAGE_SETUP.md`](./SUPABASE_STORAGE_SETUP.md) ·
[`PRODUCTION_DATABASE_VALIDATION.md`](./PRODUCTION_DATABASE_VALIDATION.md) ·
[`FIRST_ADMIN_BOOTSTRAP.md`](./FIRST_ADMIN_BOOTSTRAP.md) ·
[`VECTOR_STORAGE.md`](./VECTOR_STORAGE.md)

---

## What you'll end up with

Server-side environment values (all of these live out-of-band, `DATABASE_URL` is secret):

```bash
DATABASE_URL=postgresql://USER:__set_out_of_band__@HOST:5432/postgres?sslmode=require
VECTOR_STORE=pgvector
```

---

## 1. Create the Supabase project — HUMAN ACTION (account / billing)

> **HUMAN ACTION.** Creating the account, accepting Supabase terms, choosing a paid plan,
> and adding a payment method are **human-only**. Claude Code / automation must not create
> the account, accept terms, or add a card.

1. Sign in to Supabase and **create a new project**.
2. Choose the **region** closest to your users / matching your residency posture (this is
   also the region you will use for Storage — see [`SUPABASE_STORAGE_SETUP.md`](./SUPABASE_STORAGE_SETUP.md)).
3. Set a **strong database password** at creation. Treat it as a secret — put it straight
   into your secrets manager; do not paste it into a ticket or chat.
4. Wait for the project to finish provisioning.

---

## 2. Get the connection strings (pooled vs direct)

Supabase exposes more than one connection string. You need **two different ones** for two
different jobs:

| Use | Which Supabase string | Why |
|---|---|---|
| **Migrations / seed / bootstrap** (this doc) | **Direct connection** (session, host `db.<project-ref>.supabase.co`, port `5432`) | DDL and prepared statements need a real session; the transaction pooler does not support them. |
| **The running app** | Pooled connection (session/transaction pooler) is fine for the app's normal traffic | Connection pooling for many short queries. |

For the migration/seed/bootstrap steps below, export the **direct** connection string.
`sslmode=require` is **mandatory** (the validator enforces TLS to the DB):

```bash
# Secret — set out of band, never commit:
export DATABASE_URL='postgresql://USER:__set_out_of_band__@db.<project-ref>.supabase.co:5432/postgres?sslmode=require'
```

> Copy the exact host/user Supabase shows for the **Direct** connection. `USER` is
> typically `postgres`. The password is the one you set in step 1.

---

## 3. Enable the pgvector extension

BIINA's production RAG store uses `pgvector`. Enable the extension **once**, in the
Supabase SQL editor (or via `psql` against the direct connection):

```sql
create extension if not exists vector;
```

You can enable it in the Supabase dashboard under **Database → Extensions → `vector`**
instead — either is fine. It must be enabled **before** `VECTOR_STORE=pgvector` serves
traffic.

---

## 4. Apply the migrations (additive-only, 0000–0015)

There are **16 migrations** committed in `apps/web/drizzle/` (`0000` … `0015`). Apply them
in order against the **direct** `DATABASE_URL`:

```bash
npm run db:migrate -w apps/web    # applies 0000 → 0015 in order
```

See [`PRODUCTION_DATABASE_VALIDATION.md`](./PRODUCTION_DATABASE_VALIDATION.md) for the
from-scratch ordering / additive-only validation procedure.

---

## 5. Seed production-safe system data

Load **plans + deployment profiles only** — no test users, no mock providers, no test
billing:

```bash
npm run db:seed:production -w apps/web
```

The production seed **refuses to run against `localhost`/`127.0.0.1`** (unless
`ALLOW_LOCAL_PROD_SEED=true`) and refuses if `validate-production` reports critical config
problems. Against a real Supabase host it runs normally.

---

## 6. Bootstrap the first admin (no hard-coded credentials)

There is **no seeded admin password**. Promote a real, already-signed-up user:

1. **Sign up** the intended admin through the app UI (the invite-only signup gate must
   allow their email).
2. **Promote** them to `SUPER_ADMIN`:

   ```bash
   BOOTSTRAP_ADMIN_EMAIL=<your-admin-email> npm run bootstrap:admin -w apps/web
   ```

See [`FIRST_ADMIN_BOOTSTRAP.md`](./FIRST_ADMIN_BOOTSTRAP.md) for details.

---

## 7. Wire the app environment

Set these on the app host / in the secrets manager (do **not** commit; `DATABASE_URL` is a
secret):

```bash
DATABASE_URL=postgresql://USER:__set_out_of_band__@HOST:5432/postgres?sslmode=require
VECTOR_STORE=pgvector
```

Restart / redeploy the app so it reads the new environment.

---

## Verify

1. **Direct DB reachability** — from a host with the direct `DATABASE_URL` exported:

   ```bash
   psql "$DATABASE_URL" -c 'select 1;'    # → one row, value 1
   ```

2. **pgvector present**:

   ```bash
   psql "$DATABASE_URL" -c "select extname from pg_extension where extname='vector';"
   # → one row: vector
   ```

3. **Migration count** — confirm all 16 applied (adjust the tracking table name if your
   migrator differs):

   ```bash
   psql "$DATABASE_URL" -c "select count(*) from drizzle.__drizzle_migrations;"
   # → 16
   ```

4. **App-level health** — once the app is running against this DB:

   ```bash
   curl -fsS https://<app-host>/api/health   # → 200 { "status": "ok", checks.database: "ok" }
   ```

5. **Admin readiness** — signed-in admin `GET /api/admin/production-readiness` shows no
   CRITICAL findings for the database/config.

---

## What Claude / CI can check

- `npm run validate:production -w apps/web` — flags a localhost/dev DB as a **BLOCKER**,
  confirms `VECTOR_STORE`, and never prints a secret value.
- `npm run smoke:production -w apps/web` (with `BASE_URL=https://<app-host>`) — confirms
  `/api/health` reports `database: ok` and that the health payload leaks no secret-shaped
  string (including no `postgresql://` connection string).

Automation can run these read-only checks. It must **not** create the Supabase account,
accept terms, choose a paid plan, or add a payment method — those are HUMAN ACTIONS.
