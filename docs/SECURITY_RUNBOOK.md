# BIINA.ai — Security Runbook

Response procedures for security incidents. Structure for each:
**detect → contain → investigate → recover → communicate → postmortem.**

> This runbook is operational only. It makes **no legal / regulatory
> breach-notification claims**; consult `<legal-counsel>` for any notification
> obligations — that decision is out of scope here.

Security on-call: `<security-oncall>` · Incident commander: `<incident-commander>` ·
Legal: `<legal-counsel>` · See `INCIDENT_RESPONSE.md` for severities & routing.

---

## Cross-cutting first moves (any security incident)
1. **Open an incident** (`INCIDENT_RESPONSE.md`), assign an incident commander,
   start a timeline log.
2. **Preserve evidence** before changing anything: capture relevant logs (they are
   structured JSON, secrets redacted — `OBSERVABILITY.md`), DB state, and config.
3. **Contain before you clean.** Stopping ongoing harm outranks root-causing.

---

## 1. Suspected secret leak (key/token in git, logs, or client)

**Detect** — a secret found in a commit, a log line, an error report, or the
browser bundle; a secret-scanning alert.

**Contain**
- Treat the secret as compromised. Rotate it immediately
  (`OPERATIONS_RUNBOOK.md` §7):
  - `AUTH_SECRET`, `CONNECTOR_CREDENTIAL_ENCRYPTION_KEY` (⚠ re-encrypt, see
    `CONNECTOR_RUNBOOK.md` §5), `STRIPE_SECRET_KEY`/`STRIPE_WEBHOOK_SECRET`,
    `WORKFLOW_TICK_SECRET`, provider API keys/base URLs.
- If in git history, rotation is mandatory even after removal — history is public
  once pushed.

**Investigate** — how it leaked (bad log call, committed `.env`, client exposure).
Confirm logger redaction (`REDACT_KEYS`) covers the pattern; the rule remains
**don't log secrets at all**.

**Recover** — deploy with the new secret; verify the subsystem works; confirm the
old secret is invalid at the provider.

**Communicate** — internal notification to `<security-oncall>`/`<eng-lead>`;
customer/legal comms only per `<legal-counsel>`.

**Postmortem** — add a test/guard so that class of secret cannot be logged or
committed again (e.g. pre-commit scan, log-field allowlist).

---

## 2. Cross-tenant access report (data isolation)

**Detect** — a user/org reports seeing another tenant's data, or an anomaly in
logs suggests an authorization gap.

**Contain**
- If a specific surface leaks, disable it via its kill switch (agent tools,
  library, enterprise surfaces — `OPERATIONS_RUNBOOK.md` §8) while you verify.
- Reproduce in a controlled way; do **not** browse real tenant data beyond what's
  needed to confirm.

**Investigate**
- Authorization is server-side (`requireAdmin`/`getCurrentUser`, membership
  checks). Private AI providers are tenant-isolated in routing
  (`satisfiesEnterprisePolicy`: an `ORGANIZATION`-owned provider is usable only by
  its owning org). Confirm the failing path actually performs its server-side
  check and doesn't trust a client-supplied id.
- Check whether org context (`organizationId`) was set **before** membership
  verification anywhere.

**Recover** — patch the authorization gap, add a regression test (tenant-isolation
tests are part of the security suite), redeploy.

**Communicate / Postmortem** — scope which tenants/records were exposed; comms per
`<legal-counsel>`; postmortem focuses on the missing server-side check.

---

## 3. Compromised OAuth connector credential

**Detect** — anomalous connector activity, provider alert, or a leaked
`CONNECTOR_CREDENTIAL_ENCRYPTION_KEY`.

**Contain**
- If the **encryption key** is compromised: treat all stored connector tokens as
  burned. Force-revoke/clear them; require reconnect; rotate + re-encrypt
  (`CONNECTOR_RUNBOOK.md` §5).
- If a **single** connection is abused: revoke that connection's tokens and
  prompt that user to reconnect; consider disabling the tool
  (`AGENT_DISABLED_TOOLS`/`WORKFLOW_DISABLED_TOOLS`).

**Investigate** — what the token could access; whether writes occurred (agent
writes are default-off; check audit logs).

**Recover** — new key/tokens in place; connectors refresh cleanly.

**Communicate / Postmortem** — notify affected users to reconnect; comms per
`<legal-counsel>`.

---

## 4. Admin account compromise

**Detect** — unexpected `SUPER_ADMIN` actions, new admin promotions, config
changes you didn't make.

**Contain**
- Rotate `AUTH_SECRET` to invalidate all sessions (forces re-login platform-wide).
- Demote/suspend the compromised admin account; verify the `users.role` set.
- If provider/model/budget config was tampered with, freeze the AI control plane
  by setting `ai_settings.maintenanceMode` while you review.

**Investigate** — audit the admin's recent actions (audit logs are separate from
application logs — `OBSERVABILITY.md`). Confirm no rogue admins were created
(only `bootstrap-admin` promotes, and it has **no hard-coded credentials**).

**Recover** — reset the legitimate admin with MFA enforced (`bootstrap-admin`
prints a reminder to enforce MFA), restore any tampered config from a known-good
backup, clear maintenance mode.

**Communicate / Postmortem** — internal; require MFA on all admin accounts; review
who holds `SUPER_ADMIN`.

---

## 5. Malicious library / marketplace item (suspend flow)

**Detect** — a reported/observed harmful published item (agent/workflow template).

**Contain**
- **Suspend the specific item platform-wide** via env:
  `LIBRARY_SUSPENDED_ITEMS="<slug-or-id>"` → the item is treated as suspended
  everywhere (restart to apply).
- If broader: `PUBLIC_LIBRARY_ENABLED=false` (hide public items),
  `LIBRARY_INSTALLATION_ENABLED=false` (block new installs), or
  `LIBRARY_ENABLED=false` (whole library off) — `OPERATIONS_RUNBOOK.md` §8.
- Recall: HIGH_RISK executable patterns are structurally **not publishable**
  (`PUBLISHABLE_MAX_RISK = SCHEDULED_WRITE`), and installs are capped
  (`HARD_MAX_INSTALLED_*`). Financial/destructive agent actions are `DENY` by
  default (`src/server/agent/risk.ts`).

**Investigate** — what the item did, who installed it, whether any writes occurred
(default-off), the review gap that let it through.

**Recover** — remove/patch the item, notify installers if needed, then lift the
suspension flags.

**Communicate / Postmortem** — tighten review criteria; add a check for the abuse
pattern.

---

## 6. General recover / verify checklist
- [ ] Compromised secrets rotated (and re-encrypted where required).
- [ ] `GET /api/health` `200`; `production-readiness` 0 CRITICAL.
- [ ] Affected kill switches restored only after the fix is verified.
- [ ] Regression test added for the specific gap.
- [ ] Timeline + postmortem filed (`INCIDENT_RESPONSE.md`).
