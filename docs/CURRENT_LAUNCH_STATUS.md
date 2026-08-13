# BIINA.ai — Current Launch Status

**As of this launch audit.** The single honest statement of the highest **safe** launch
tier BIINA.ai can occupy right now, and exactly what unlocks the next tier.

Grounded in real state: the Phase 18 decision was **GO — INTERNAL / PILOT ONLY**
(commit `9bc921e`), and the current configuration defaults still point at mock/dev
integrations for the three externally-facing dependencies (AI inference, email, durable
storage). See [`LAUNCH_BACKLOG.md`](./LAUNCH_BACKLOG.md) for the itemized backlog.

---

## Current safe tier: **INTERNAL ONLY**

**Why this and not higher:** the app builds, passes ~291 tests, has GO-grade security
controls, and migrations `0000`–`0015` apply clean — but **no real external-facing
integration is configured today**:

| Dependency | Current default | Consequence |
|---|---|---|
| AI inference | `AI_DEFAULT_PROVIDER=mock` | No real answers; prod refuses mock (fails safe). |
| Email | `EMAIL_PROVIDER=dev` (console) | Verification/reset/invite emails do not deliver. |
| Object storage | `FILE_STORAGE_PROVIDER=local` | Not durable; unsafe for real user files. |
| Hosting / DNS / TLS | none provisioned | Nothing reachable by external users. |

With those at mock/dev/local, the only safe use is **internal, on trusted infrastructure,
by the team** — e.g. a local or internal deployment with a real model pointed at it for
evaluation. It is **not** safe to invite external users yet.

**Safe to do at this tier:**
- Run the app internally for the team to exercise flows.
- Point a real inference endpoint at an internal instance for evaluation.
- Bootstrap the first admin (see [`FIRST_ADMIN_BOOTSTRAP.md`](./FIRST_ADMIN_BOOTSTRAP.md)).
- Run `npm run validate:production` against a target config to see remaining blockers.

**Not safe yet:**
- Inviting any external user (no email delivery, no durable storage, no production host).
- Charging money (billing is TEST mode — [`LIVE_BILLING_ACTIVATION.md`](./LIVE_BILLING_ACTIVATION.md)).
- Any claim of general availability, certification, or sovereignty.

---

## Next tier: **INVITE-ONLY BETA** — the gating list

The moment the following human/infrastructure actions are complete, the honest tier
becomes **invite-only beta** (a controlled tier, not GA). Each maps to a backlog item and
to [`HUMAN_LAUNCH_ACTIONS.md`](./HUMAN_LAUNCH_ACTIONS.md):

- [ ] **Production hosting + managed Postgres 16** provisioned, DB not localhost (LB-07).
- [ ] **Production domain + DNS + TLS** on `app.biina.ai` (LB-07).
- [ ] **Real AI inference endpoint + credential** configured, not `mock` (LB-01).
- [ ] **Email provider + verified sender domain** (SPF/DKIM/DMARC), adapter wired (LB-02).
- [ ] **Durable object storage** (S3/R2) **if Files/RAG ship ON**; otherwise hold Files/RAG
      OFF/BETA (LB-03).
- [ ] **Real embedding endpoint** if RAG retrieval ships ON (LB-04).
- [ ] **Basic monitoring** (uptime + errors + AI cost alarm) and centralized logs (LB-08).
- [ ] **Automated backups + one verified restore drill** (LB-09).
- [ ] **Conservative feature flags** set per [`V1_FEATURE_FLAGS.md`](./V1_FEATURE_FLAGS.md).
- [ ] `npm run validate:production` reports **0 blockers** against the production config.
- [ ] At least **Privacy + ToS + AUP** in place for external invitees (LB-17, legal review).

**Gate:** `npm run validate:production` must exit clean (0 blockers) and `/api/health` must
return ok for app + database + aiGateway on the deployed instance.

---

## Tiers beyond invite-only beta (not reachable yet)

| Tier | Additionally requires |
|---|---|
| **Wider / public beta** | External pen test / security review (LB-16); full ToS/Privacy/AUP/Cookie; monitoring maturity; load-tested Scale triggers. |
| **Paid** | Live billing activation (LB-10) + Subscription/Refund legal review (LB-17). |
| **General availability** | Deliberate go/no-go after beta evidence; not a default (see [`POST_LAUNCH_PLAN.md`](./POST_LAUNCH_PLAN.md)). |
| **UAE / sovereign** | In-region infra + security + legal reviews (see [`UAE_DEPLOYMENT_REVIEW.md`](./UAE_DEPLOYMENT_REVIEW.md)); not a configuration claim. |

---

## One-line status

**Today: INTERNAL ONLY.** Reaches **INVITE-ONLY BETA** the moment production hosting, DNS/TLS,
a real AI endpoint, a real email adapter+domain, and (if Files/RAG are ON) durable storage are
in place — with `validate:production` passing. Nothing on the path is a security defect; the
gaps are unfinished external integrations, held safe by fail-closed guards.
