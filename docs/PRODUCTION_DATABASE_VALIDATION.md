# Production Database Validation — BIINA.ai

A **repeatable, from-scratch** procedure that proves the schema builds cleanly on an
**empty** database and that seeding produces **only** production-safe system data — no dev
seed data, no test accounts. Run it on staging before every cutover; paste the actual run
output where indicated.

Related: [`STAGING_DEPLOYMENT.md`](./STAGING_DEPLOYMENT.md) ·
[`BACKUP_RESTORE_RUNBOOK.md`](./BACKUP_RESTORE_RUNBOOK.md) ·
[`PRODUCTION_CUTOVER.md`](./PRODUCTION_CUTOVER.md)

---

## Preconditions

- A **fresh, empty** managed Postgres database (never production data).
- `DATABASE_URL` set to that database (`sslmode=require`).
- Config validated: `npm run validate:production -w apps/web` shows no BLOCKERs.

---

## Procedure

### Step 1 — Empty database

Confirm the target has **no application tables** (only a bare Postgres, optionally with the
`pgvector` extension available if used).

```bash
psql "$DATABASE_URL" -c "\dt"      # expect: no application relations
```

_Paste output:_

```
<run output here>
```

### Step 2 — Migrate 0000 → 0015

```bash
npm run db:migrate -w apps/web
```

This runs `scripts/migrate.ts` and applies the Drizzle journal in order. There are **16
migrations, `0000`–`0015`**:

| Range | Contents (additive) |
|---|---|
| `0000`–`0008` | Core: auth/users, plans & entitlements, conversations, billing, connectors |
| `0009_agent_engine` | Agent engine |
| `0010_workflows` | Workflows/scheduler |
| `0011_memory` | Memory |
| `0012_multimodal` | Multimodal |
| `0013_research` | Research |
| `0014_library` | Library |
| `0015_enterprise` | Enterprise (orgs/RBAC) |

_Paste output:_

```
<run output here>
```

### Step 3 — Seed production-safe system data

```bash
npm run db:seed:production -w apps/web
```

`scripts/seed-production.ts` seeds **only**: the **plan catalog** (`FREE`, `PRO`,
`BUSINESS`, `ENTERPRISE`, `ADMIN`), baseline **deployment profiles** (`shared-saas`,
`uae-sovereign` readiness template), and the core AI settings singleton **with no mock
provider and no secrets**. It creates **no** test users, **no** default-password admin,
**no** mock AI provider, **no** test billing prices. It **refuses** localhost unless
`ALLOW_LOCAL_PROD_SEED=true`, and refuses on critical config problems.

_Paste output:_

```
<run output here>
```

### Step 4 — App start / health

Start the app and confirm readiness:

```bash
curl -fsS https://<host>/api/health          # 200 { status: "ok", checks: { app, database, config, aiGateway } }
```

`/api/health` returns `503` if app, database, or (in production) config readiness fails —
**without leaking** which variable is at fault. Admin detail is at
`GET /api/admin/production-readiness`.

_Paste output:_

```
<run output here>
```

---

## What to check (acceptance)

| # | Check | How to confirm | Result |
|---|---|---|---|
| 1 | **Migration ordering** | 0000→0015 apply in sequence with no gaps/errors (Step 2) | ☐ |
| 2 | **No destructive migrations** | Only **additive** DDL, plus two `ALTER TYPE … ADD VALUE` (`0003` adds `SUPER_ADMIN`; `0015` adds `ARCHIVED`) and **one** `DROP NOT NULL` (`0005`, `plan_assignments.user_id`). **No** `DROP TABLE`, `DROP COLUMN`, `DELETE`, or `TRUNCATE`. | ☐ |
| 3 | **No dev seed data / test accounts** | `SELECT count(*) FROM users;` → **0** after Step 3 (the seed creates no users) | ☐ |
| 4 | **Plans present** | `SELECT slug FROM plans ORDER BY slug;` → `ADMIN, BUSINESS, ENTERPRISE, FREE, PRO` | ☐ |
| 5 | **Deployment profiles present** | `SELECT slug FROM deployment_profiles ORDER BY slug;` → includes `shared-saas`, `uae-sovereign` | ☐ |
| 6 | **No mock providers** | AI settings singleton has no `mock` provider row (the seed never writes one) | ☐ |
| 7 | **Foreign keys valid** | No orphaned FKs: `SELECT conname FROM pg_constraint WHERE contype='f' AND NOT convalidated;` → empty | ☐ |
| 8 | **Key indexes present** | Expected indexes/unique constraints exist (e.g. `users.email` unique, tenant/org scoping indexes). `\d+ users` and `\di` to inspect | ☐ |

> Checks 2's specifics are verifiable in-repo: destructive-pattern scan over
> `apps/web/drizzle/*.sql` finds only the `ALTER TYPE … ADD VALUE` (0003, 0015) and the
> single `DROP NOT NULL` (0005) noted above.

---

## Repeatability

This procedure is **idempotent at the seed layer**: re-running `db:seed:production` inserts
missing plan/profile rows only (existence-checked) and never overwrites operator-tuned
entitlements. Re-running migrations replays the journal (already-applied migrations are
skipped). Keep a dated copy of each run's pasted output alongside the cutover record.
