# BIINA.ai — Backup & Restore Runbook

Exact backup and restore procedures for the Postgres database, object storage,
and the vector store. Procedures follow **detect → act → verify**.

> **A restore is not "done" until it has been tested by a real restore drill.**
> An untested backup is a hope, not a backup. Schedule periodic restore drills
> (`<restore-drill-cadence>`).

On-call: `<ops-oncall>` · DBA/infra owner: `<infra-owner>`

Component durability at a glance:

| Component | Today | Status | Recovery source |
|---|---|---|---|
| Postgres | managed/self-hosted DB | **REQUIRES INFRA** (backups are your DB platform's job) | pg_dump / managed snapshot |
| Object storage (files) | `LocalFileStorage` (`FILE_STORAGE_PROVIDER=local`) | **IMPLEMENTED but not durable** — S3/R2 slots reserved | storage backup / re-upload |
| Vector store | `PortableVectorStore` (jsonb + cosine in Postgres) | **IMPLEMENTED**; pgvector reserved | **rebuildable from source documents** |
| Connector creds | AES-256-GCM in Postgres | IMPLEMENTED | included in DB backup (needs the key to decrypt) |

---

## 1. Backup — database

Migrations are committed offline (`apps/web/drizzle/` `0000`–`0015`); the schema
is reproducible from git. **Data** must be backed up separately.

**Managed DB (recommended, REQUIRES INFRA):** enable automated
snapshots/point-in-time recovery on your DB platform. Verify the schedule and
retention (`<db-backup-retention>`) actually exist.

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

Today storage is local disk (`LocalFileStorage`) — **not durable** and lost with
the host. Before production, move `STORAGE_PROVIDER` to a durable object store
(S3/R2 — slots reserved) (**REQUIRES INFRA**).

**Act** — back up the storage root/bucket on the same or tighter cadence as the
DB. Durable object stores provide their own versioning/replication; enable it.

**Verify** — a sample file is retrievable from the backup.

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

Vectors in `PortableVectorStore` are **derived, not source-of-truth** — they are
**rebuildable from the source documents/files**. If the vector data is lost,
stale, or you migrate to pgvector, rebuild rather than restore:

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
