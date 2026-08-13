# BIINA.ai — Launch Backlog (master)

The single, honest list of everything still standing between the current build and a
**controlled external launch**. Extracted from the Phase 18 launch readiness set
([`LAUNCH_CHECKLIST.md`](./LAUNCH_CHECKLIST.md),
[`PRODUCTION_INFRASTRUCTURE_CHECKLIST.md`](./PRODUCTION_INFRASTRUCTURE_CHECKLIST.md),
[`FEATURE_FLAGS.md`](./FEATURE_FLAGS.md),
[`DISASTER_RECOVERY.md`](./DISASTER_RECOVERY.md),
[`OBSERVABILITY.md`](./OBSERVABILITY.md),
[`UAE_DEPLOYMENT_REVIEW.md`](./UAE_DEPLOYMENT_REVIEW.md)) plus a fresh launch audit of the
current code and flag defaults.

> **Honest rule applied throughout.** An **unfinished OPTIONAL feature that is safely
> disabled by a flag is NOT a launch blocker** — it is `RESOLVED-BY-DISABLING`, with the
> flag default as its evidence. A **security or reliability problem in an ENABLED feature
> IS a blocker.** A doc existing does **not** close an item — closure needs the stated
> evidence/test. The Phase 18 GO decision was **GO — INTERNAL / PILOT ONLY**; the residual
> blockers below are unfinished integrations, **not** audited security defects (security
> controls were audited GO-grade — see the Phase 18 commit `9bc921e`).

Severity legend: **BLOCKER** (must resolve before the named launch tier) · **HIGH** ·
**MEDIUM** · **LOW** · **POST-LAUNCH** · **HUMAN ACTION REQUIRED** (only a
person/business/provider can do it — Claude Code cannot). Status: **OPEN** ·
**RESOLVED-BY-DISABLING** · **SAFE DEFAULT**.

Companion: [`HUMAN_LAUNCH_ACTIONS.md`](./HUMAN_LAUNCH_ACTIONS.md) ·
[`CURRENT_LAUNCH_STATUS.md`](./CURRENT_LAUNCH_STATUS.md) ·
[`POST_LAUNCH_BACKLOG.md`](./POST_LAUNCH_BACKLOG.md).

---

## Summary

| ID | Title | Severity | Category | Status |
|---|---|---|---|---|
| LB-01 | No real AI inference endpoint configured | **BLOCKER** (any external launch) · HUMAN ACTION | AI | OPEN |
| LB-02 | Email adapter is mock (console only) | **BLOCKER** (verification/reset/invite flows) · HUMAN ACTION + code | Platform | OPEN |
| LB-03 | Durable object storage not configured (local FS) | **BLOCKER if Files/RAG ON** · HUMAN ACTION | Storage | OPEN |
| LB-04 | Production embedding endpoint not configured (dev embedder) | **HIGH if RAG ON** · HUMAN ACTION | AI | OPEN |
| LB-05 | Multimodal providers (vision/OCR/STT/TTS) are mock | MEDIUM | Multimodal | RESOLVED-BY-DISABLING |
| LB-06 | Rate limiting is process-local (in-memory) | **HIGH if multi-instance** · POST-LAUNCH otherwise | Reliability | OPEN |
| LB-07 | No production infra: hosting/DNS/TLS/CDN/WAF | **BLOCKER** (any external launch) · HUMAN ACTION | Infrastructure | OPEN |
| LB-08 | Monitoring / alerting / centralized logging not wired | **HIGH** · HUMAN ACTION | Observability | OPEN |
| LB-09 | Automated backups + verified restore drill not done | **HIGH** · HUMAN ACTION | Reliability | OPEN |
| LB-10 | Live billing off (Stripe TEST mode) | HUMAN ACTION | Billing | SAFE DEFAULT |
| LB-11 | Web search provider is mock (no vendor key) | LOW | Search | RESOLVED-BY-DISABLING |
| LB-12 | Vector store on PortableVectorStore (pgvector reserved) | POST-LAUNCH | Storage | SAFE DEFAULT |
| LB-13 | In-process scheduler/worker (single-instance) | POST-LAUNCH | Reliability | SAFE DEFAULT |
| LB-14 | Agent external writes / scheduled writes disabled | MEDIUM | Automation | RESOLVED-BY-DISABLING |
| LB-15 | Enterprise identity (SAML/SCIM) + sovereign mode off | MEDIUM | Enterprise | RESOLVED-BY-DISABLING |
| LB-16 | External penetration test / security review not performed | **HIGH** · HUMAN ACTION | Security | OPEN |
| LB-17 | Legal documents (ToS/Privacy/AUP/Subscription/Refund/Cookie) | **BLOCKER for paid/public** · HUMAN ACTION | Legal | OPEN |
| LB-18 | `drizzle-orm` dependency bump | LOW | Dependencies | POST-LAUNCH |

---

## Detail

### LB-01 — No real AI inference endpoint configured
- **Severity:** BLOCKER (for any launch that serves real answers) · HUMAN ACTION REQUIRED
- **Category:** AI
- **Description:** `AI_DEFAULT_PROVIDER` is `mock` in `.env.example`; no real endpoint/model
  is configured. The gateway supports `ollama` and `openai-compatible` (vLLM/RunPod-ready)
  but none is pointed at a live endpoint.
- **Launch impact:** Without a real endpoint the product cannot answer users. Code already
  refuses `mock` in production (`config/production.ts`, `validate-production.ts` → BLOCKER),
  so the app fails safe rather than serving fake output.
- **Code action required:** None — provider abstraction + registry already exist.
- **Human action required:** Provision an inference endpoint, set `AI_DEFAULT_PROVIDER`
  (`openai-compatible`/`ollama`) + base URL + model + optional key as server-side env. See
  [`VLLM_DEPLOYMENT.md`](./VLLM_DEPLOYMENT.md), [`RUNPOD_SETUP.md`](./RUNPOD_SETUP.md),
  [`AI_PROVIDER_RUNBOOK.md`](./AI_PROVIDER_RUNBOOK.md).
- **Dependency:** Production hosting (LB-07).
- **Status:** OPEN.
- **Evidence for closure:** `npm run validate:production` shows `OK AI_DEFAULT_PROVIDER` (not
  mock); a live chat request returns a real completion; `/api/ai/health` healthy.

### LB-02 — Email adapter is mock (console only)
- **Severity:** BLOCKER (for verification/reset/invitation flows) · HUMAN ACTION + small code task
- **Category:** Platform services
- **Description:** Transactional email is a mock/console adapter. `EMAIL_PROVIDER=dev` in the
  examples; no real provider wired. `RESEND_API_KEY` / `SMTP_URL` are recognized by the
  validator but unset.
- **Launch impact:** Any flow that emails a user (email verification, password reset, org
  invitations, notifications) silently fails to deliver. This blocks self-serve signup for
  external users. `validate-production.ts` flags missing email as WARNING (not BLOCKER),
  because it is only blocking for the flows that need it — treat it as a BLOCKER the moment
  external users must verify or reset.
- **Code action required:** Wire a real email adapter behind the existing interface (a small,
  legitimate launch-enabling code task — Resend/SMTP). No architectural change.
- **Human action required:** Provide the email provider + sender domain with SPF/DKIM/DMARC;
  set `RESEND_API_KEY` or `SMTP_URL` out-of-band.
- **Dependency:** Sender domain + DNS (LB-07).
- **Status:** OPEN.
- **Evidence for closure:** `validate-production.ts` shows `OK Email`; a real verification and
  a real reset email are received end-to-end.

### LB-03 — Durable object storage not configured (local FS)
- **Severity:** BLOCKER **if Files / RAG is ON** · HUMAN ACTION REQUIRED
- **Category:** Storage
- **Description:** `FILE_STORAGE_PROVIDER=local` (LocalFileStorage). S3/R2 support is reserved
  but not configured. The production config validator flags local storage as **not durable**
  (HIGH in prod; BLOCKER in `validate-production.ts` when `isProduction()`).
- **Launch impact:** Local disk is not durable and does not survive host replacement; enabling
  Files/Knowledge bases/RAG on local storage risks data loss. If Files/RAG ship ON, this is a
  hard blocker; if Files/RAG are held OFF/BETA at launch, it downgrades to HIGH.
- **Code action required:** None — storage interface + S3/R2 slot already exist.
- **Human action required:** Provision an S3/R2 bucket + credentials; set
  `FILE_STORAGE_PROVIDER=s3|r2` (checklist also refers to `STORAGE_PROVIDER=s3|r2`). See
  [`FILES.md`](./FILES.md).
- **Dependency:** None (independent of AI).
- **Status:** OPEN.
- **Evidence for closure:** `validate-production.ts` shows `OK FILE_STORAGE_PROVIDER`; a file
  upload + retrieval round-trips against the durable bucket.

### LB-04 — Production embedding endpoint not configured (dev embedder)
- **Severity:** HIGH **if RAG/memory retrieval is ON** · HUMAN ACTION REQUIRED
- **Category:** AI
- **Description:** `EMBEDDING_PROVIDER=deterministic` — a deterministic lexical dev embedder
  that lets the pipeline run offline but is **not production-quality**. Real provider config
  (`EMBEDDING_BASE_URL`/`EMBEDDING_API_KEY`) is reserved but unset.
- **Launch impact:** RAG, web grounding, and memory retrieval quality will be poor on the dev
  embedder. Not a safety issue; a quality/relevance issue for any enabled retrieval feature.
- **Code action required:** None — embedder interface already pluggable; re-embedding rebuilds
  the vector store.
- **Human action required:** Configure a real embedding endpoint. See [`EMBEDDINGS.md`](./EMBEDDINGS.md).
- **Dependency:** Tied to whether Files/RAG (LB-03) ship ON.
- **Status:** OPEN.
- **Evidence for closure:** Real embedder configured; retrieval returns relevant chunks on a
  test corpus.

### LB-05 — Multimodal providers (vision/OCR/STT/TTS) are mock
- **Severity:** MEDIUM
- **Category:** Multimodal
- **Description:** `MULTIMODAL_ENABLED=true` but every provider is mock
  (`VISION_PROVIDER=mock`, `OCR_PROVIDER=mock`, `STT_PROVIDER=mock`, `TTS_PROVIDER=mock`);
  `VOICE_MODE_ENABLED=false`.
- **Launch impact:** None **as long as these surfaces are not presented as real to external
  users.** Vision is at most BETA and reverts to OFF until a real provider is validated; voice
  is OFF by flag.
- **Code action required:** None for launch (real providers are a post-launch integration).
- **Human action required:** For later activation, provide real vision/OCR/STT/TTS providers.
- **Dependency:** —
- **Status:** RESOLVED-BY-DISABLING (keep vision BETA→OFF until real provider; voice OFF).
- **Evidence for closure (as disabled):** `VOICE_MODE_ENABLED=false`; vision held BETA/OFF per
  [`V1_FEATURE_FLAGS.md`](./V1_FEATURE_FLAGS.md). Full closure (as enabled) needs real
  providers validated per [`MULTIMODAL_ACTIVATION_CHECKLIST.md`](./MULTIMODAL_ACTIVATION_CHECKLIST.md).

### LB-06 — Rate limiting is process-local (in-memory)
- **Severity:** HIGH **if more than one app instance runs** · POST-LAUNCH while single-instance
- **Category:** Reliability
- **Description:** Rate limiting uses process-local memory. Correct only while there is
  effectively one app instance (documented as a known single-instance assumption in
  [`PRODUCTION_INFRASTRUCTURE_CHECKLIST.md`](./PRODUCTION_INFRASTRUCTURE_CHECKLIST.md) Scale
  triggers).
- **Launch impact:** For a single-instance invite-only beta, limits are enforced correctly.
  With multiple instances, limits become per-instance (effectively N× looser) — a real
  reliability/abuse gap.
- **Code action required (deferred):** Move to a shared store (e.g. Redis) so limits are global.
- **Human action required:** Decide single-instance beta vs. horizontal scale; provision a
  shared store before scaling out.
- **Dependency:** Scale decision.
- **Status:** OPEN (SAFE while single-instance).
- **Evidence for closure:** Shared rate-limit store in place, or an explicit single-instance
  constraint documented for the launch tier.

### LB-07 — No production infrastructure: hosting / DNS / TLS / CDN / WAF
- **Severity:** BLOCKER (any external launch) · HUMAN ACTION REQUIRED
- **Category:** Infrastructure
- **Description:** No production hosting, no DNS for `app.biina.ai`/`biina.ai`, no TLS, no
  CDN/WAF provisioned. Managed Postgres 16 not provisioned (validator refuses localhost DB in
  prod).
- **Launch impact:** Nothing is reachable by external users without this. HSTS + security
  headers + CSP are already emitted in middleware, and the validator rejects a non-`https://`
  app URL in production — but the hosts themselves must exist.
- **Code action required:** None.
- **Human action required:** Provision hosting, managed Postgres 16, DNS, TLS certs, and
  (recommended) CDN/WAF. See [`PRODUCTION_INFRASTRUCTURE_CHECKLIST.md`](./PRODUCTION_INFRASTRUCTURE_CHECKLIST.md)
  and [`HUMAN_LAUNCH_ACTIONS.md`](./HUMAN_LAUNCH_ACTIONS.md).
- **Dependency:** —
- **Status:** OPEN.
- **Evidence for closure:** App reachable over HTTPS on `app.biina.ai`; `/api/health` returns
  ok for app + database + aiGateway on the deployed instance.

### LB-08 — Monitoring / alerting / centralized logging not wired
- **Severity:** HIGH · HUMAN ACTION REQUIRED
- **Category:** Observability
- **Description:** Structured JSON logs (secret-redacted) and health/usage signals exist in
  code, but no external uptime check, error tracker, metrics dashboard, log sink, or alert
  routing is provisioned. The AI cost/usage alarm (dominant variable cost) is not set.
- **Launch impact:** Launching blind — no way to detect outages, cost runaway, or abuse in real
  time.
- **Code action required:** None (signals already emitted; see [`OBSERVABILITY.md`](./OBSERVABILITY.md)).
- **Human action required:** Wire uptime + error + latency + AI cost alarms and a log sink;
  choose notification destinations.
- **Dependency:** Production hosting (LB-07).
- **Status:** OPEN.
- **Evidence for closure:** Uptime check on `/api/health`, an error sink receiving events, and
  a firing test AI-cost alarm.

### LB-09 — Automated backups + verified restore drill not done
- **Severity:** HIGH · HUMAN ACTION REQUIRED
- **Category:** Reliability
- **Description:** No automated DB backups and **no restore has ever been tested**
  ([`DISASTER_RECOVERY.md`](./DISASTER_RECOVERY.md) DR readiness checklist unchecked). Vector
  store is rebuildable-from-source (mitigation), but the primary DB is authoritative.
- **Launch impact:** A DB loss with no tested restore is unrecoverable within any RTO.
- **Code action required:** None (rebuild procedure documented; forward-only migrations).
- **Human action required:** Enable automated backups/PITR, off-region copy, and perform **at
  least one verified restore drill** before opening access.
- **Dependency:** Managed Postgres (LB-07).
- **Status:** OPEN.
- **Evidence for closure:** One successful restore drill recorded; RPO/RTO agreed with the
  business.

### LB-10 — Live billing off (Stripe TEST mode)
- **Severity:** HUMAN ACTION REQUIRED (not a defect)
- **Category:** Billing
- **Description:** `BILLING_LIVE_MODE=false`; Stripe in TEST mode. Code already verifies webhook
  signatures + idempotency. If `BILLING_LIVE_MODE=true` without a `sk_live_` key,
  `validate-production.ts` emits a BLOCKER — the guard fails safe.
- **Launch impact:** None for a free beta (recommended). Blocks charging real money until
  activated — which is the intended safe default.
- **Code action required:** None.
- **Human action required:** Complete [`LIVE_BILLING_ACTIVATION.md`](./LIVE_BILLING_ACTIVATION.md)
  before any live charge.
- **Dependency:** Legal review (LB-17).
- **Status:** SAFE DEFAULT (leave off unless a paid beta is explicitly approved + legally reviewed).
- **Evidence for closure (if activating):** Live keys + prices + verified live webhook;
  `validate-production.ts` shows `OK Billing` in live mode.

### LB-11 — Web search provider is mock (no vendor key)
- **Severity:** LOW
- **Category:** Search
- **Description:** `WEB_SEARCH_ENABLED=false`, `WEB_SEARCH_PROVIDER=mock`. Pipeline is complete;
  no live vendor key configured, so real results are unavailable.
- **Launch impact:** None while disabled. Web grounding stays BETA/OFF.
- **Code action required:** None.
- **Human action required (to enable later):** Provide a search vendor key; watch per-query cost.
- **Dependency:** —
- **Status:** RESOLVED-BY-DISABLING.
- **Evidence for closure (as disabled):** `WEB_SEARCH_ENABLED=false`.

### LB-12 — Vector store on PortableVectorStore (pgvector reserved)
- **Severity:** POST-LAUNCH
- **Category:** Storage
- **Description:** `VECTOR_STORE=portable` (jsonb + cosine, in the same Postgres, rebuildable
  from source). `pgvector` reserved for scale.
- **Launch impact:** None for beta — explicitly acceptable per the infra checklist. A latency
  concern only as the corpus grows (a Scale trigger).
- **Code action required (deferred):** Migrate to `pgvector` behind the same interface.
- **Human action required:** Provision pgvector at scale. See [`VECTOR_STORAGE.md`](./VECTOR_STORAGE.md).
- **Dependency:** Scale trigger.
- **Status:** SAFE DEFAULT.
- **Evidence for closure:** N/A for launch; tracked in [`POST_LAUNCH_BACKLOG.md`](./POST_LAUNCH_BACKLOG.md).

### LB-13 — In-process scheduler/worker (single-instance)
- **Severity:** POST-LAUNCH
- **Category:** Reliability
- **Description:** Scheduler is DB-authoritative, driven by an external tick
  (`/api/internal/workflows/tick` + `WORKFLOW_TICK_SECRET`); the worker/ticker runs in-process.
  Acceptable only at low volume (multiple workers are safe — unique run keys prevent
  double-fire).
- **Launch impact:** Fine for a low-volume beta. Move out-of-process at scale.
- **Code action required (deferred):** Separate worker process/host.
- **Human action required:** Provide a reliable clock source to hit the tick endpoint. See
  [`SCHEDULER.md`](./SCHEDULER.md).
- **Dependency:** Scale trigger.
- **Status:** SAFE DEFAULT.
- **Evidence for closure:** N/A for launch.

### LB-14 — Agent external writes / scheduled writes disabled
- **Severity:** MEDIUM
- **Category:** Automation
- **Description:** `AGENT_WRITE_ACTIONS_ENABLED=false` and `WORKFLOW_SCHEDULED_WRITES_ENABLED=false`.
  Real external writes ship on mock adapters and are denied by default; high-risk/destructive
  actions denied by the risk taxonomy.
- **Launch impact:** None — the highest-risk paths are off by design. Read-only agents/workflows
  can run as BETA.
- **Code action required:** None.
- **Human action required (to enable later):** Live scopes + manual activation + validated
  approval flow.
- **Dependency:** —
- **Status:** RESOLVED-BY-DISABLING.
- **Evidence for closure (as disabled):** Both flags `false`; kill switches confirmed.

### LB-15 — Enterprise identity (SAML/SCIM) + sovereign mode off
- **Severity:** MEDIUM
- **Category:** Enterprise
- **Description:** `SAML_ENABLED=false`, `SCIM_ENABLED=false`, `SOVEREIGN_MODE_ENABLED=false`.
  The default structural SSO verifier **fails closed in production** (enabling SSO without a
  real cryptographic verifier rejects rather than accepts forged assertions).
- **Launch impact:** None — enterprise-only surfaces stay off; no false sovereignty/compliance
  claim. See [`UAE_DEPLOYMENT_REVIEW.md`](./UAE_DEPLOYMENT_REVIEW.md).
- **Code action required:** None.
- **Human action required (to enable later):** Org config + a real SSO verifier; for sovereign,
  in-region infra + security/legal reviews.
- **Dependency:** —
- **Status:** RESOLVED-BY-DISABLING.
- **Evidence for closure (as disabled):** All three flags `false`.

### LB-16 — External penetration test / security review not performed
- **Severity:** HIGH · HUMAN ACTION REQUIRED
- **Category:** Security
- **Description:** Internal Phase 18 audit found controls GO-grade, but **no external pen test /
  security review has been performed** ([`LAUNCH_CHECKLIST.md`](./LAUNCH_CHECKLIST.md) Security;
  scope in [`PEN_TEST_SCOPE.md`](./PEN_TEST_SCOPE.md)).
- **Launch impact:** Acceptable to open a small invite-only beta with the internal audit, but an
  external review must be scheduled/scoped before widening the cohort or going paid/public.
- **Code action required:** None (remediate findings if any arise).
- **Human action required:** Engage a third party; scope + schedule the review.
- **Dependency:** Deployed environment.
- **Status:** OPEN.
- **Evidence for closure:** External review completed; findings triaged/remediated.

### LB-17 — Legal documents (ToS / Privacy / AUP / Subscription / Refund / Cookie)
- **Severity:** BLOCKER for paid or public launch · HUMAN ACTION REQUIRED (legal review)
- **Category:** Legal
- **Description:** No ToS, Privacy Policy, AUP, Subscription Terms, Refund/Cancellation policy,
  or Cookie/consent policy are in place. All are `REQUIRES LEGAL REVIEW`; this repo does **not**
  draft legal terms.
- **Launch impact:** Subscription/Refund terms are required before **any** live charge.
  ToS/Privacy/AUP are required before public exposure. A closed internal pilot can proceed under
  internal agreement, but external invite users still need at least Privacy + ToS + AUP.
- **Code action required:** None.
- **Human action required:** Obtain legally reviewed documents; publish them + a support/abuse
  contact.
- **Dependency:** Billing activation (LB-10) for subscription/refund terms.
- **Status:** OPEN.
- **Evidence for closure:** Reviewed documents published and linked from the app.

### LB-18 — `drizzle-orm` dependency bump
- **Severity:** LOW · POST-LAUNCH
- **Category:** Dependencies
- **Description:** `drizzle-orm@^0.36.4`; a newer version is available. Non-urgent maintenance.
- **Launch impact:** None. ~291 tests pass and the build is clean on the current version.
- **Code action required:** Bump + re-run the suite in a maintenance window.
- **Human action required:** None.
- **Dependency:** —
- **Status:** POST-LAUNCH. Tracked in [`POST_LAUNCH_BACKLOG.md`](./POST_LAUNCH_BACKLOG.md).
- **Evidence for closure:** Bumped; ~291 tests + build green.

---

## What is NOT on this backlog (and why)

These were checked and are **not** launch items:

- **Security controls** — audited GO-grade in Phase 18 (auth, authz, IDOR, tenant isolation,
  SSRF, SQLi, upload hardening, secret redaction, webhook signatures). No open security defect.
- **Build/tests** — `npm run build` clean; ~291 tests pass; migrations `0000`–`0015` apply
  clean. Verified in Phase 18.
- **Kill switches** — present and fail-closed for writes/external/paid/SSO and AI maintenance
  mode.
