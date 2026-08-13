# BIINA.ai — Backup & Restore Runbook

Exact backup and restore procedures for the Postgres database, object storage,
and the vector store. Procedures follow **detect → act → verify**.

> **A restore is not "done" until it has been tested by a real restore drill.**
> An untested backup is a hope, not a backup. Schedule periodic restore drills
> (`<restore-drill-cadence>`).

On-call: `<ops-oncall>` · DBA/infra owner: `<infra-owner>`

Component durability at a glance (invite-only beta stack — Supabase-managed):

| Component | Beta config | Status | Recovery source |
|---|---|---|---|
| Postgres | **Supabase managed** Postgres 16 (`DATABASE_URL`) | **REQUIRES INFRA** (backups are Supabase's job — verify they're enabled) | Supabase snapshot / PITR · pg_dump |
| Object storage (files) | **Supabase Storage** via the S3 adapter (`FILE_STORAGE_PROVIDER=s3`, private bucket) | **CONFIGURED** — durable (managed) | Supabase Storage versioning/backup · re-upload |
| Vector store | `pgvector` (`VECTOR_STORE=pgvector`) on the same Supabase Postgres | **IMPLEMENTED** | **rebuildable from source documents** (also inside the DB backup) |
| Connector creds | AES-256-GCM in Postgres | IMPLEMENTED | in the DB backup — **needs `CONNECTOR_CREDENTIAL_ENCRYPTION_KEY` to decrypt** (back the key up separately) |

> **Key-loss warning (read first):** `CONNECTOR_CREDENTIAL_ENCRYPTION_KEY` is **not** stored
> in the database — it lives only in your secret manager / the box's `.env.production`. A
> Supabase snapshot or `pg_dump` contains the connector ciphertext but **cannot** decrypt it
> without this key. **Back the key up in the secrets manager (and a durable second location),
> separate from the DB dump.** Lose the key ⇒ every stored connector credential is
> **permanently unrecoverable** and users must reconnect. See §1 and
> [`PRODUCTION_SECRET_CHECKLIST.md`](./PRODUCTION_SECRET_CHECKLIST.md).

---

## 1. Backup — database

Migrations are committed offline (`apps/web/drizzle/` `0000`–`0015`); the schema
is reproducible from git. **Data** must be backed up separately.

**Managed DB — Supabase (beta default, REQUIRES INFRA / HUMAN ACTION):** the Postgres
instance is Supabase-managed, so backups are **Supabase's job — but only if enabled**.
Enable automated daily backups and/or point-in-time recovery in the Supabase project, and
**verify** the schedule and retention (`<db-backup-retention>`) actually exist (do not
assume the default plan includes PITR). See [Supabase specifics](#supabase-specifics) below.

**Logical dump (portable):**
```bash
pg_dump --format=custom --no-owner --no-privileges \
  "$DATABASE_URL" > biina-$(date +%Y%m%d-%H%M%S).dump
```
Store the dump encrypted, off the app host (`<backup-bucket>`). The dump contains
AES-256-GCM connector ciphertext — it is **only decryptable with the matching
`CONNECTOR_CREDENTIAL_ENCRYPTION_KEY`**, so back up that key separately in the
secret manager (never in the same place as the dump, never in git).

**Verify** — dump completes without error; file size is plausible; record which
`CONNECTOR_CREDENTIAL_ENCRYPTION_KEY` version it pairs with.

---

## 2. Backup — object storage (uploaded files)

For the beta, uploaded files live in **Supabase Storage** via the S3 adapter
(`FILE_STORAGE_PROVIDER=s3`, a **private** bucket) — **not** the old `LocalFileStorage`
default, which was not durable and is not used in production. Objects are stored opaque and
served only as download attachments.

**Act** — the managed bucket is durable, but treat backup as an explicit step, not an
assumption:
- Enable **versioning/backup on the Supabase Storage bucket** per Supabase (so an accidental
  delete or overwrite is recoverable). Confirm it is actually on.
- Keep object-storage recovery points on the same or a tighter cadence than the DB so file
  references resolve consistently (see §6 on orphan-reference avoidance).

**Verify** — a sample file is retrievable from the bucket/backup, and an object version
history exists.

---

### Supabase specifics

The beta runs Postgres **and** object storage on Supabase, so most of "backup" is verifying
Supabase's own features are switched on, plus keeping the one thing Supabase can't hold — the
encryption key — safe elsewhere.

- **Where DB snapshots live.** Supabase takes managed backups on the project's plan
  (scheduled snapshots, and **point-in-time recovery** on plans that include it). They live
  in the Supabase project, **not** on the Hetzner box. **HUMAN ACTION:** open the Supabase
  project → Database → Backups and confirm snapshots and (if available) PITR are **enabled**
  and the retention matches `<db-backup-retention>`. Not on = no backup.
- **How to restore.** Restore a snapshot / PITR target **into a fresh Supabase project or a
  clean database** from the Supabase dashboard (never overwrite the only good copy) — this is
  the managed equivalent of §3 step 2. Then point `DATABASE_URL` at the restored target, run
  migrations (§3 step 3), and run the §4 validation. For a portable path, a `pg_dump` from
  the Supabase connection string + `pg_restore` (§1/§3) also works.
- **The storage bucket.** Uploaded files are in the Supabase Storage **private** bucket
  (`S3_BUCKET`, reached via `S3_ENDPOINT` with the `S3_*` credentials). Enable bucket
  versioning/backup in Supabase. On restore, ensure the target env points at the bucket that
  matches the DB recovery point so file references resolve (§6).
- **Vector store.** With `VECTOR_STORE=pgvector` the vectors live **inside** the Supabase
  Postgres, so a DB snapshot already captures them. They remain **rebuildable from source
  documents** (§5) if you'd rather re-embed than restore.
- **The encryption key is NOT in Supabase.** `CONNECTOR_CREDENTIAL_ENCRYPTION_KEY` lives only
  in your secret manager / `.env.production`. A Supabase restore brings back the connector
  **ciphertext** but decrypts nothing without this key — back it up separately (see the
  key-loss warning above and §3 step 5).

---

## 3. Restore — full sequence (exact order)

> Do a restore into a **fresh, isolated target** first (drill or real recovery),
> never overwrite the only good copy.

1. **Provision** a clean Postgres instance/target (REQUIRES INFRA).
2. **Restore data** into it:
   - Managed snapshot → restore per your platform, **or**
   - Logical dump:
     ```bash
     pg_restore --clean --if-exists --no-owner --no-privileges \
       --dbname "$RESTORE_DATABASE_URL" biina-<timestamp>.dump
     ```
3. **Run migrations** to bring schema to current (safe/idempotent; applies only
   pending files — a dump from an older schema is fast-forwarded):
   ```bash
   DATABASE_URL="$RESTORE_DATABASE_URL" npm run db:migrate -w apps/web
   ```
4. **Restore object storage** to the target's storage backend (Section 2), so file
   references in the DB resolve.
5. **Restore the encryption key** — set the matching
   `CONNECTOR_CREDENTIAL_ENCRYPTION_KEY` in the target env, or connector
   credentials will not decrypt (users would need to reconnect).
6. **Validate** (Section 4).
7. **Start the app** against the restored target; run smoke tests
   (`RELEASE_PROCESS.md`).

---

## 4. Validate a restore (before declaring success)

- [ ] `psql "$RESTORE_DATABASE_URL" -c 'select 1'` succeeds.
- [ ] `GET /api/health` on the app pointed at the target → `200`, `database: ok`.
- [ ] Row-count sanity check on key tables (users, plans, subscriptions,
      conversations) vs expectations.
- [ ] Login works; a conversation loads (proves data + schema).
- [ ] A connector still decrypts (proves the encryption key matches) — or note
      that reconnect is required.
- [ ] Uploaded files resolve (proves storage restore + no orphan references).
- [ ] Rebuild vectors if needed (Section 5).
- [ ] `production-readiness` shows 0 CRITICAL for the target env.

Only after these pass is the restore "done."

---

## 5. Vector index rebuild (from source documents)

Vectors are **derived, not source-of-truth** — whether they live in `pgvector`
(`VECTOR_STORE=pgvector`, the beta config, inside the Supabase Postgres) or the portable
`PortableVectorStore` (jsonb), they are **rebuildable from the source documents/files**. A
DB snapshot already captures pgvector data; even so, if the vector data is lost, stale, or
you're re-provisioning, rebuild rather than restore:

**Act**
1. Ensure the **source documents** (uploaded files / knowledge-base content) are
   restored first (Sections 2–3) — vectors regenerate from these.
2. Trigger re-embedding/re-indexing of the affected documents (per
   `docs/EMBEDDINGS.md` / `docs/VECTOR_STORAGE.md` / `RAG_ARCHITECTURE.md`).
   Re-embedding calls the embedding provider — mind cost (`COST_CONTROL_RUNBOOK.md`).

**Verify** — a RAG query returns relevant chunks; no dangling references to
missing source documents.

---

## 6. Object-storage durability & orphan-reference avoidance

- Files and their DB references must be restored **consistently**: restoring the DB
  to a **later** point than storage → DB references files that don't exist
  (broken); restoring storage later than the DB → orphaned blobs with no reference
  (waste, minor). Prefer snapshots taken close in time; validate with the
  "uploaded files resolve" check (Section 4).
- On a durable object store, enable versioning so an accidental delete is
  recoverable.

---

## Do-not-do
- Never call a backup validated until a **test restore** has passed.
- Never store the DB dump and `CONNECTOR_CREDENTIAL_ENCRYPTION_KEY` together.
- Never restore over your only good copy.
