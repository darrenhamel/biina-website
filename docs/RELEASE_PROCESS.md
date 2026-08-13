# BIINA.ai — Release Process

How a change goes from merge to production, safely and reviewably. Aligns with the
phased build model (`docs/ROADMAP.md`) and the runbooks.

Release manager: `<release-manager>` · Approver: `<eng-lead>`

---

## Versioning (semver)
- `MAJOR.MINOR.PATCH`. Current baseline: **0.1.0** (foundational build — see
  `/CHANGELOG.md`).
- Pre-1.0: **MINOR** = new capabilities / phase completions; **PATCH** = fixes and
  small improvements. Breaking internal changes are allowed pre-1.0 but must be
  called out in the changelog.
- Post-1.0: **MAJOR** = breaking API/behavior; **MINOR** = backward-compatible
  features; **PATCH** = fixes.
- Tag releases `v<version>`; keep `/CHANGELOG.md` (Keep-a-Changelog style) updated
  in the same PR that ships the change.

---

## Required CI checks (must be green to release)
Run against `apps/web` (workspace-scoped):

| Check | Command |
|---|---|
| Typecheck | `npm run typecheck -w apps/web` |
| Lint | `npm run lint -w apps/web` |
| Unit + security tests | `npm run test -w apps/web` (Vitest — includes tenant-isolation, rate-limit, billing, routing tests) |
| Migration validation | migrations generated offline & committed; `npm run db:migrate` applies cleanly against a scratch DB |
| Production build | `npm run build -w apps/web` |

A release with any red check does not proceed.

---

## The release pipeline

### 1. Version + changelog
- Bump version; add a `/CHANGELOG.md` entry (Added/Changed/Fixed/Security).
- Note any new env vars → update `.env.example` (owned by app; coordinate) and the
  relevant runbook.

### 2. Migration review
- Review each new `apps/web/drizzle/*.sql`: forward-only, safe on live data
  (avoid destructive column drops without a plan), backfill strategy if needed.
- Confirm migrations are **committed** (generated offline via `db:generate`), not
  generated at deploy time.

### 3. Staging deploy
- Deploy the release candidate to staging (**REQUIRES INFRA**).
- Apply migrations against the staging DB: `npm run db:migrate -w apps/web`.
- Confirm `GET /api/health` `200` and `GET /api/admin/production-readiness` shows
  **0 CRITICAL / 0 HIGH** for the staging env.

### 4. Smoke test (staging)
Minimum smoke set (blocking):
- [ ] App loads at `/{locale}`; EN + AR (RTL) render.
- [ ] Sign up / login / logout.
- [ ] Send a chat message; receive a streamed response.
- [ ] Load conversation history.
- [ ] File upload + a RAG query.
- [ ] Admin loads; production-readiness clean.
- [ ] A Stripe **test** checkout + webhook → `200`, plan updates.
- [ ] Manual scheduler tick returns a result (`WORKFLOW_RUNBOOK.md`).

### 5. Production approval
- `<eng-lead>` (or delegate) signs off on green CI + staging smoke.
- Any paid-provider / live-billing / destructive-infra change needs **explicit
  human approval** (`CLAUDE.md` hard rule).

### 6. Deploy to production
- **Back up the DB first** (`BACKUP_RESTORE_RUNBOOK.md`).
- Apply migrations: `DATABASE_URL='<prod>' npm run db:migrate -w apps/web`.
- Roll out the new build/image (`OPERATIONS_RUNBOOK.md` §1).
- Confirm the cron/worker points at the new release.

### 7. Post-deploy validation
- [ ] `GET /api/health` `200`, `database: ok`.
- [ ] `production-readiness` 0 CRITICAL.
- [ ] Re-run the smoke set (prod-safe subset; Stripe test/live per environment).
- [ ] Error rate + latency at baseline (`OBSERVABILITY.md`).
- [ ] `workflow.tick` logs flowing.

### 8. Rollback criteria
Trigger rollback (`OPERATIONS_RUNBOOK.md` §2) if within the watch window:
- Health stays `503` > `<5m>`, or
- Error rate > `<threshold>`, or
- Auth / checkout / webhooks broken, or
- A smoke-test blocker fails.
Prefer a **kill switch** for a single misbehaving feature over a full rollback.

---

## First production go-live (one-time)
1. Provision infra (DB, storage, edge, worker cron) — REQUIRES INFRA.
2. Set all critical env vars; `production-readiness` must be 0 CRITICAL.
3. `npm run db:migrate -w apps/web`.
4. `npm run db:seed:production -w apps/web` (plans + deployment profiles; refuses
   localhost/critical-config).
5. First admin: user signs up, then `BOOTSTRAP_ADMIN_EMAIL=<email> npm run
   bootstrap:admin -w apps/web` (promotes to SUPER_ADMIN; **no hard-coded creds**;
   enforce MFA).
6. Complete `docs/PRODUCTION_BILLING_CHECKLIST.md` before enabling live billing.
7. Run through the phase activation checklists as features are turned on.
