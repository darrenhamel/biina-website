# Launch Test Matrix — BIINA.ai

What is verified, where, and whether it gates launch. The automated suite is **grounded in
the real repo** (`apps/web/test/*.test.ts`, **28 test files, ~291 tests, all passing** via
`npm run test -w apps/web`, also enforced in CI at
[`.github/workflows/ci.yml`](../.github/workflows/ci.yml)). Manual/staging journeys and
anything needing live infrastructure are honestly marked **PENDING-STAGING** /
**REQUIRES-INFRA** — automated tests passing is **not** the same as validated-in-production.

Status: **Passed** · **Failed** · **Skipped** · **PENDING-STAGING** (needs a deployed
staging env) · **REQUIRES-INFRA** (needs live inference / real email / durable storage / load rig)

Related: [`STAGING_DEPLOYMENT.md`](./STAGING_DEPLOYMENT.md) ·
[`GO_LIVE_RUNBOOK.md`](./GO_LIVE_RUNBOOK.md) ·
[`LOAD_TESTING.md`](./LOAD_TESTING.md) ·
[`CURRENT_LAUNCH_STATUS.md`](./CURRENT_LAUNCH_STATUS.md)

---

## A. Automated suite (passing today)

Environment = **CI / local** (`vitest run`). Evidence = the test file under `apps/web/test/`.

| Feature | Test | Environment | Result | Launch Critical? | Evidence |
|---|---|---|---|---|---|
| Auth / input validation | Auth field & flow validation | CI | Passed | Yes | `auth-validation.test.ts` |
| Validation (shared) | Zod schema / boundary validation | CI | Passed | Yes | `validation.test.ts` |
| Permissions / RBAC | Role & permission enforcement | CI | Passed | Yes | `permissions.test.ts` |
| Tenant isolation (enterprise) | Cross-tenant/org isolation safety | CI | Passed | Yes | `enterprise-safety.test.ts` |
| Org slug | Org slug uniqueness/format | CI | Passed | No | `org-slug.test.ts` |
| AI gateway | Provider abstraction contract | CI | Passed | Yes | `ai-gateway.test.ts` |
| AI routing | Model/provider routing (no vendor leak) | CI | Passed | Yes | `ai-routing.test.ts` |
| AI metering | Usage metering accuracy | CI | Passed | Yes | `ai-metering.test.ts` |
| Provider: Ollama | Ollama adapter | CI | Passed | No¹ | `ollama-provider.test.ts` |
| Provider: OpenAI-compatible | vLLM/OpenAI-compatible adapter | CI | Passed | Yes¹ | `openai-compatible-provider.test.ts` |
| System prompt safety | No internal-prompt exposure | CI | Passed | Yes | `system-prompt.test.ts` |
| Rate limiting | Process-local limiter behavior | CI | Passed | Yes² | `rate-limit.test.ts` |
| Billing entitlements | Plan → entitlement mapping | CI | Passed | Yes | `billing-entitlements.test.ts` |
| Billing (Stripe) | Webhook signature + idempotency | CI | Passed | Yes | `billing-stripe.test.ts` |
| Billing validation | Billing config/state guards | CI | Passed | Yes | `billing-validation.test.ts` |
| Connector security | Connector credential/scope safety | CI | Passed | Yes | `connector-security.test.ts` |
| RAG core | Retrieval / chunking / citations core | CI | Passed | Yes | `rag-core.test.ts` |
| Memory safety | Memory privacy/isolation | CI | Passed | Yes | `memory-safety.test.ts` |
| Multimodal safety | Multimodal input guards | CI | Passed | No | `multimodal-safety.test.ts` |
| Research safety | Research feature guards | CI | Passed | No | `research-safety.test.ts` |
| Agent safety | Agent execution guards | CI | Passed | Yes | `agent-safety.test.ts` |
| Workflow safety | Workflow/scheduler guards | CI | Passed | Yes | `workflow-safety.test.ts` |
| Library safety | Library publishing guards | CI | Passed | No | `library-safety.test.ts` |
| Web security | Web-search/grounding safety | CI | Passed | No | `web-security.test.ts` |
| Email | Email rendering/dispatch logic | CI | Passed | Yes³ | `email.test.ts` |
| Personas | Persona configuration | CI | Passed | No | `personas.test.ts` |
| i18n / RTL | Bilingual EN/AR + RTL | CI | Passed | Yes | `i18n.test.ts` |
| **Production safety** | Prod config guards (mock refused, local-storage BLOCKER, secret non-leak) | CI | Passed | **Yes** | `production-safety.test.ts` |

¹ At least one real provider adapter must back the configured production endpoint; Ollama
vs OpenAI-compatible depends on the chosen endpoint. ² Correct **only** single-instance
(see topology). ³ Logic tested; **real delivery** is REQUIRES-INFRA (below).

**Suite health:** `npm run test -w apps/web` → all pass (~291). CI additionally runs
typecheck, lint, migrate, and build.

---

## B. Manual / staging journeys (PENDING-STAGING)

These require a deployed, isolated staging env ([`STAGING_DEPLOYMENT.md`](./STAGING_DEPLOYMENT.md)).
They are **not** covered by the automated suite and are **launch-critical**.

| Feature | Test | Environment | Result | Launch Critical? | Evidence |
|---|---|---|---|---|---|
| Signup → login | Full auth journey against a deployed app | Staging | PENDING-STAGING | Yes | `<staging run>` |
| Chat + streaming | Send prompt, tokens stream | Staging | PENDING-STAGING | Yes | `<staging run>` |
| Persistence | Reload shows conversation history | Staging | PENDING-STAGING | Yes | `<staging run>` |
| File upload → RAG → citation | Upload doc, retrieve, cite | Staging | PENDING-STAGING | Yes | `<staging run>` |
| Memory | Recall across sessions | Staging | PENDING-STAGING | Yes | `<staging run>` |
| Settings + logout | Change settings; clean logout | Staging | PENDING-STAGING | No | `<staging run>` |
| Paid journey (TEST billing) | Stripe TEST checkout → entitlement → webhook | Staging | PENDING-STAGING | Yes | `<staging run>` |
| Organization journey | Create org, invite, member joins, isolation | Staging | PENDING-STAGING | Yes | `<staging run>` |
| Scheduled workflow | External tick advances a scheduled workflow | Staging | PENDING-STAGING | Yes | `<staging run>` |
| Health / readiness | `/api/health` 200; admin readiness detail | Staging | PENDING-STAGING | Yes | `<staging run>` |

---

## C. Requires live infrastructure (REQUIRES-INFRA)

Honest gaps that **cannot** be closed by tests alone. Several are **launch BLOCKERs**.

| Capability | What must be validated | Result | Launch Critical? | Blocker ref |
|---|---|---|---|---|
| **Live AI inference** | A real production endpoint answers a live prompt (mock is refused in prod; **none configured yet**) | REQUIRES-INFRA | **Yes — BLOCKER** | [`GO_LIVE_RUNBOOK.md`](./GO_LIVE_RUNBOOK.md) step 11 |
| **Real email delivery** | Verification/reset/invite mail actually delivered (code default is mock/console) | REQUIRES-INFRA | Yes | [`PRODUCTION_CUTOVER.md`](./PRODUCTION_CUTOVER.md) §7 |
| **Durable storage** | S3/R2 configured — prerequisite for Files/RAG (local FS is a prod BLOCKER) | REQUIRES-INFRA | Yes | [`PRODUCTION_CUTOVER.md`](./PRODUCTION_CUTOVER.md) §4 |
| **Scheduler tick** | External cron calls the tick with the secret (else scheduled workflows silently don't run) | REQUIRES-INFRA | Yes | [`PRODUCTION_CUTOVER.md`](./PRODUCTION_CUTOVER.md) §11 |
| **Load / concurrency** | Real load test at target concurrency (TTFT, error rate, breaker) | REQUIRES-INFRA | Yes | [`LOAD_TESTING.md`](./LOAD_TESTING.md) |
| **Cost controls under load** | Quotas/budgets/circuit breaker trip correctly with real spend | REQUIRES-INFRA | Yes | [`COST_CONTROLS.md`](./COST_CONTROLS.md) |
| **Backup restore** | A restore is actually performed and verified | REQUIRES-INFRA | Yes | [`BACKUP_RESTORE_RUNBOOK.md`](./BACKUP_RESTORE_RUNBOOK.md) |

---

## Summary

- ✅ **Automated:** ~291 tests across 28 files pass (unit, security, tenant-isolation,
  billing, ai-routing, RAG, enterprise, production-safety), enforced in CI.
- ⏳ **Staging journeys:** PENDING-STAGING — require a deployed staging env.
- 🚧 **Live inference, real email, durable storage, and load tests:** PENDING /
  REQUIRES-INFRA — some are launch BLOCKERs.

Automated green is necessary but **not sufficient** for go-live. Close Sections B and C
before opening cohort access.
