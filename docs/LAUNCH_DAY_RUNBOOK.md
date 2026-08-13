# BIINA.ai — Launch Day Runbook (Phase 18)

Ordered, do-this-then-that steps for launch day of the **invite-only beta**. Assumes the
infrastructure and pre-launch items in [`LAUNCH_CHECKLIST.md`](./LAUNCH_CHECKLIST.md) are
already **DONE**. Run top to bottom; do not skip the backup checkpoint or the rollback
threshold agreement.

> Roles: name a **launch lead** (runs this doc), a **deployer**, and an **on-call** for the
> window before you begin.

Companions: [`DISASTER_RECOVERY.md`](./DISASTER_RECOVERY.md),
[`OBSERVABILITY.md`](./OBSERVABILITY.md),
[`FEATURE_FLAGS.md`](./FEATURE_FLAGS.md),
[`POST_LAUNCH_PLAN.md`](./POST_LAUNCH_PLAN.md).

---

## 0. Pre-flight (T-60 min)
- ☐ Confirm the config validator passes in the target env (no CRITICAL findings).
- ☐ Confirm feature flags match the conservative v1 scope (see [`FEATURE_FLAGS.md`](./FEATURE_FLAGS.md)).
- ☐ Confirm `AI_DEFAULT_PROVIDER` is a **real** provider (not `mock`) and reachable.
- ☐ Confirm access is still gated (invite/allowlist not yet open).
- ☐ Confirm the **rollback threshold + procedure** below is agreed and everyone has the
  commands.

## 1. Pre-launch DB backup checkpoint
- ☐ Take an explicit, labeled backup/snapshot of the production database **now** (label it
  `pre-launch-<date>`).
- ☐ Verify the snapshot completed and is restorable in principle (recorded restore point).
- ☐ Record the object-storage state / versioning marker if applicable.
- **Do not proceed until this checkpoint exists.** This is the primary rollback anchor.

## 2. Deploy
- ☐ Deploy the built `apps/web` release to the production host.
- ☐ Confirm the startup **config validator** passed (app refused to start on CRITICAL config
  otherwise).
- ☐ Confirm migrations are at `0015` on the production DB (no pending migration).
- ☐ Confirm the worker/scheduler tick path is live (in-process for beta, or the separate
  worker is up).

## 3. Smoke test (access still gated)
Run against production while access is still restricted to the team:
- ☐ `GET /api/health` → `status: ok`, checks `app/database/aiGateway` all ok.
- ☐ Sign up → email verification delivered → log in → log out.
- ☐ Start a chat; confirm a **real** streamed answer, Stop, and Regenerate work.
- ☐ Upload a file; confirm RAG retrieval grounds an answer (vector store responding).
- ☐ Confirm EN/AR + RTL render correctly.
- ☐ Confirm an admin can reach the admin surfaces + maintenance-mode toggle.
- ☐ Confirm no secrets appear in logs; error tracking is receiving events.
- **If any smoke test fails → stop, fix or roll back (section 7). Do not open access.**

## 4. Enable selected feature flags
- ☐ Flip **only** the flags for the v1 scope to their intended launch state (see
  [`FEATURE_FLAGS.md`](./FEATURE_FLAGS.md)); leave high-risk features OFF/behind flags.
- ☐ Re-verify the app still healthy after each material flag change.
- ☐ Leave agent **writes**, scheduled external writes, open marketplace, SAML/SCIM,
  sovereign mode, and voice **OFF** unless explicitly approved for beta.

## 5. Enable billing — only if approved
- ☐ **Default: leave Stripe in TEST mode.** Skip this section for a free beta.
- ☐ If (and only if) live billing is approved **and** subscription/refund terms have passed
  legal review: complete
  [`PRODUCTION_BILLING_CHECKLIST.md`](./PRODUCTION_BILLING_CHECKLIST.md), set live keys, flip
  the two billing safety flags, and run **one** end-to-end test purchase + webhook receipt
  before opening.

## 6. Open access + monitor
- ☐ Open the invite/allowlist to the first beta cohort.
- ☐ Watch for the first ~60–120 min, then at a decreasing cadence:
  - **Errors:** error rate + new exception types.
  - **Latency:** request latency and AI TTFT/streaming health; provider 429/503.
  - **Cost:** AI token spend vs the cost alarm (dominant variable cost).
  - **Capacity:** DB connection utilization, queue/tick lag, vector retrieval latency.
- ☐ Log anomalies to the [`POST_LAUNCH_PLAN.md`](./POST_LAUNCH_PLAN.md) tracker.

## 7. Rollback threshold + procedure
**Trigger a rollback if any of these hold and cannot be fixed forward quickly:**
- Health check failing or sustained 5xx error rate above the agreed threshold
  (`<place agreed % here>`).
- Auth, chat generation, or billing (if live) broken for users.
- Any suspected data-integrity issue or secret exposure.
- AI spend spiking far beyond the cost alarm with no quick mitigation.

**Procedure:**
1. ☐ Announce rollback to the launch team; **close access** (re-gate invite/allowlist) first.
2. ☐ If needed, enable **AI maintenance mode** (DB-backed) and/or relevant kill switches to
   stop side effects.
3. ☐ Redeploy the previous known-good release.
4. ☐ Only if data is corrupted: restore from the **pre-launch checkpoint** (section 1) per
   [`DISASTER_RECOVERY.md`](./DISASTER_RECOVERY.md) — restore is a last resort, not the first
   move. If live billing was enabled, reconcile Stripe state before reopening.
5. ☐ Verify health + a smoke test on the rolled-back release.
6. ☐ Write a short incident note; schedule the fix; retry launch later.

## 8. Handoff
- ☐ Confirm on-call ownership for the next window.
- ☐ Start the 24h watch in [`POST_LAUNCH_PLAN.md`](./POST_LAUNCH_PLAN.md).
