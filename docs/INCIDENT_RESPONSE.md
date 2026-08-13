# BIINA.ai — Incident Response

How BIINA declares, runs, and closes incidents. Pairs with the runbooks
(`OPERATIONS_RUNBOOK.md`, `SECURITY_RUNBOOK.md`, etc.) and `OBSERVABILITY.md`.

> Operational only. **No jurisdiction-specific legal claims** — any regulatory
> notification decision is made with `<legal-counsel>` and is out of scope here.

Incident commander (default): `<incident-commander>` · Security on-call:
`<security-oncall>` · Ops on-call: `<ops-oncall>` · Comms: `<comms-owner>` ·
Legal: `<legal-counsel>` · Status page: `<status-page-url>`

---

## Severity definitions

| Sev | Definition | Examples | Response |
|---|---|---|---|
| **SEV1** | Critical: broad outage or confirmed security/data incident | Site down, DB down, confirmed cross-tenant data exposure, secret compromise, confirmed billing charge errors at scale | Page immediately; IC + all relevant on-call; continuous updates |
| **SEV2** | Major: significant degradation, single major subsystem down | AI all-provider outage, checkout down, scheduler stalled, region degraded | Page; IC assigned; updates every `<30m>` |
| **SEV3** | Minor: partial/feature degradation, workaround exists | One provider/model down w/ fallback, one connector broken, elevated latency | Business-hours; owner assigned; updates as needed |
| **SEV4** | Low: cosmetic or isolated, no user impact | Single-user glitch, minor log noise | Tracked; fixed in normal flow |

When unsure, **round up** a severity.

---

## The incident runbook (all severities)

### 1. Detect
- Source: alert (`OBSERVABILITY.md`), user report, or on-call observation.
- Confirm it's real: `GET /api/health`, `production-readiness`, dashboards.

### 2. Contain
- Stop ongoing harm before root-causing. Use the fastest safe lever:
  kill switches (`OPERATIONS_RUNBOOK.md` §8), maintenance mode
  (`ai_settings.maintenanceMode`), budget hard limit, rollback, or connector/tool
  disable.
- Preserve evidence for security incidents **before** changing state
  (`SECURITY_RUNBOOK.md`).

### 3. Investigate
- Use `requestId` correlation and structured logs (secrets redacted).
- Identify root cause and blast radius (which users/tenants/subsystems).

### 4. Recover
- Apply the fix (roll forward / restore / rotate / re-enable).
- Verify with health, smoke tests, and the relevant runbook's verify step.

### 5. Communicate
- **Internal:** incident channel with a running timeline; IC posts updates at the
  cadence for the severity.
- **External:** status page + customer comms via `<comms-owner>`; wording that
  makes **no unproven claims**. Legal/regulatory comms only via `<legal-counsel>`.

### 6. Postmortem (SEV1/SEV2 always; SEV3 if useful)
- Blameless. Timeline, root cause, contributing factors, what detected it, what
  slowed recovery.
- Action items with owners + due dates; add a **regression test/guard** for the
  specific gap. File within `<postmortem-SLA>`.

---

## Incident types → first runbook

| Type | Go to |
|---|---|
| Security / suspected secret leak | `SECURITY_RUNBOOK.md` §1 |
| Data-leak suspicion / cross-tenant | `SECURITY_RUNBOOK.md` §2 |
| Provider compromise (connector) | `SECURITY_RUNBOOK.md` §3 · `CONNECTOR_RUNBOOK.md` |
| Credential leak | `SECURITY_RUNBOOK.md` §1 · `OPERATIONS_RUNBOOK.md` §7 |
| Admin compromise | `SECURITY_RUNBOOK.md` §4 |
| Billing incident | `BILLING_RUNBOOK.md` |
| Outage (app/DB/region) | `OPERATIONS_RUNBOOK.md` · `DISASTER_RECOVERY.md` |
| AI provider outage | `AI_PROVIDER_RUNBOOK.md` |
| AI runaway cost | `COST_CONTROL_RUNBOOK.md` |
| Workflow/scheduler | `WORKFLOW_RUNBOOK.md` |
| Malicious marketplace item | `SECURITY_RUNBOOK.md` §5 |

---

## On-call routing (placeholders)

```
Alert / report
   │
   ├─ Security signal ─────────► <security-oncall> ──► IC <incident-commander>
   ├─ Availability / infra ────► <ops-oncall> ───────► IC <incident-commander>
   ├─ Billing ─────────────────► <billing-owner>  (+ <ops-oncall> if user-facing)
   └─ AI / cost ───────────────► <ai-platform-owner> / <finance-eng-owner>

Escalation: on-call → <eng-lead> → <incident-commander>
Comms: <comms-owner>   Legal: <legal-counsel>
```

Fill placeholders with a real rotation (`<pagerduty-or-oncall-tool>`) before launch.

---

## Declaring / closing
- **Declare** when severity ≥ SEV3 is confirmed: assign IC, open channel, set
  severity, start timeline.
- **Close** when: user impact resolved, verified via health + smoke tests, root
  cause understood (or a follow-up owns it), postmortem scheduled/filed.
