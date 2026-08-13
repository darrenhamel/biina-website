# BIINA.ai — Human Launch Actions

The actions that **only a human, the business, or an external provider can do** — Claude Code
cannot provision infrastructure, register domains, sign contracts, obtain legal documents, or
complete a security review. Everything here is a `REQUIRES HUMAN ACTION` /
`REQUIRES INFRASTRUCTURE` / `REQUIRES LEGAL/SECURITY REVIEW` item.

Each row: **why** it is needed and **which launch flow it unblocks**. Cross-referenced to
[`LAUNCH_BACKLOG.md`](./LAUNCH_BACKLOG.md) IDs and
[`PRODUCTION_INFRASTRUCTURE_CHECKLIST.md`](./PRODUCTION_INFRASTRUCTURE_CHECKLIST.md).

> These are deliberately **not** things the codebase can complete. The code is ready; it is
> waiting on infrastructure, credentials, business decisions, and reviews.

---

## Infrastructure & platform

| Action | Why | Unblocks | Backlog |
|---|---|---|---|
| Production **hosting** (Node 20+ app host) | Nothing runs without a host that injects secrets + runs the config validator. | Any external launch. | LB-07 |
| **Managed Postgres 16** (+ private networking/TLS) | Authoritative data store; validator refuses a localhost DB in prod. | Any external launch. | LB-07 |
| **Domain + DNS + TLS** for `app.biina.ai` (+ `biina.ai`) | Reachability + HTTPS; validator rejects a non-`https://` app URL. | Any external launch. | LB-07 |
| **CDN / WAF** in front of the app | Edge caching + basic attack/bot protection (WAF recommended even for beta). | Hardened beta. | LB-07 |
| **Durable object storage** bucket (S3/R2) + credentials | Local FS is not durable; needed for user files/media. | Files/KB/RAG ON. | LB-03 |
| **Real inference endpoint** + credential (vLLM/RunPod/Ollama host) | The product cannot answer without a real model; mock is refused in prod. | Any launch that serves answers. | LB-01 |
| **Embedding endpoint** (real embedder) | Dev embedder is low quality; needed for good RAG/memory/grounding. | RAG/memory ON. | LB-04 |
| **Email provider** + verified sender domain (SPF/DKIM/DMARC) | Verification/reset/invite emails cannot deliver on the mock adapter. | External self-serve signup / invites. | LB-02 |
| **Reliable clock source** to hit the workflow tick endpoint | The DB-authoritative scheduler needs an external tick (`WORKFLOW_TICK_SECRET`). | Scheduled workflows. | LB-13 |
| **Secrets manager / vault** | Hold `DATABASE_URL`, `AUTH_SECRET`, `CONNECTOR_CREDENTIAL_ENCRYPTION_KEY`, Stripe + AI + email secrets out of git. | Any external launch. | LB-07 |

## Observability & reliability

| Action | Why | Unblocks | Backlog |
|---|---|---|---|
| **Monitoring notification destinations** (uptime, error, latency, **AI cost alarm**) | Launching blind is unsafe; AI spend is the dominant variable cost. | Any external launch (safely). | LB-08 |
| **Centralized log sink** + retention | Retain secret-redacted logs; separate longer-retention audit logs. | Any external launch. | LB-08 |
| **Automated backups + one verified restore drill** | An untested backup is not a backup; DB loss would be unrecoverable. | Any external launch. | LB-09 |

## Billing (only if a paid tier is approved)

| Action | Why | Unblocks | Backlog |
|---|---|---|---|
| **Stripe live activation** (entity/bank verification, live approval) | Required to charge real money; code stays TEST-safe until done. | Paid plans. | LB-10 |
| **Tax + pricing configuration** (live prices, currency, tax) | Correct, compliant charging. | Paid plans. | LB-10 |
| Full [`LIVE_BILLING_ACTIVATION.md`](./LIVE_BILLING_ACTIVATION.md) checklist | Every gate before `BILLING_LIVE_MODE=true`. | Paid plans. | LB-10 |

## Legal & business

| Action | Why | Unblocks | Backlog |
|---|---|---|---|
| **Legal documents** — ToS, Privacy, AUP, Subscription, Refund/Cancellation, Cookie/consent | Required for external users; Subscription/Refund required before any live charge. This repo does not draft legal terms. | External beta (ToS/Privacy/AUP) → paid (Subscription/Refund). | LB-17 |
| **Support / abuse-report channel** published | Users need a contact + abuse path. | External beta. | LB-17 |
| **Beta invite/allowlist + feedback channel** decision | Controlled cohort + a way to hear from them. | Invite-only beta. | — |

## Reviews (cannot be satisfied by configuration)

| Action | Why | Unblocks | Backlog |
|---|---|---|---|
| **External penetration test / security review** | Internal audit was GO-grade, but an independent review is required before widening/paid/public. | Wider/public/paid launch. | LB-16 |
| **UAE / sovereign: in-region infra + security + legal review** | Region tags are configuration, not a compliance claim; sovereignty requires real reviews. | Any UAE/sovereign deployment. | LB-15 |

---

## Ordering guidance

For the fastest safe path to **invite-only beta**, do these first (all independent enough to
parallelize): hosting + managed Postgres + DNS/TLS (LB-07), the real AI endpoint (LB-01), the
email provider + wired adapter (LB-02), and — only if Files/RAG ship ON — durable storage
(LB-03) + a real embedder (LB-04). Then wire monitoring/backups (LB-08/LB-09) and set the
conservative flags. Confirm the whole set with `npm run validate:production` (0 blockers) and
`/api/health`. See [`CURRENT_LAUNCH_STATUS.md`](./CURRENT_LAUNCH_STATUS.md) for the gating list.
