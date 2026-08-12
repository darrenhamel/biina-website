# BIINA.ai — Library Security

Security invariants for the Template Library / marketplace foundation. A marketplace of
installable agents and automations could open serious surfaces — arbitrary code,
arbitrary network egress, permission bypass on install, cross-tenant leakage, silent
capability escalation on update, hidden write tools, data exfiltration. All are defended
**structurally**, not by trusting the model or the item author. The one sentence: **a
library item is DATA + validated configuration; installing it grants nothing.** Code:
`apps/web/src/server/library/validation.ts`, `access.ts`, `installations.ts`,
`updates.ts`, `review.ts`, `config.ts`. Extends [`SECURITY.md`](./SECURITY.md),
[`AGENT_SECURITY.md`](./AGENT_SECURITY.md),
[`AUTOMATION_SECURITY.md`](./AUTOMATION_SECURITY.md),
[`TOOL_POLICY.md`](./TOOL_POLICY.md), [`AUTHORIZATION.md`](./AUTHORIZATION.md).

## The deterministic LibraryReviewService

`validateDefinition` is the primary marketplace safety gate. It is **deterministic** —
it does **not** rely on an AI judgement — and it runs at submit time and again before
publish. Everything provable structurally, it proves:

1. **Schema conformance.** The definition must parse against its strict typed schema
   (`DEFINITION_SCHEMAS`). Anything else (arbitrary code, unknown/executable structures)
   → `schema.invalid` BLOCK.
2. **Registered tools only.** Every declared tool must exist in the trusted `AGENT_TOOLS`
   catalog (`isKnownTool`). An unknown/invented tool → `tool.unknown` BLOCK. There is
   **no arbitrary HTTP / shell / API tool** to declare.
3. **No arbitrary code / no raw network.** Authored text is scanned for `<script>`,
   JS/`eval`/`new Function`, `import`/`exec`/`subprocess`/`os.system`/`require`, shell
   commands, and **raw `http(s)://` endpoints** → `code.*` / `net.url` BLOCK. Items use
   registered connectors/tools, never embedded URLs or code.
4. **Prompt-injection / self-escalation / exfiltration phrasing** → BLOCK: overriding
   platform policy (`inj.ignore_policy`), hiding actions from the user
   (`inj.hide_actions`), exfiltrating data externally (`inj.exfiltrate`), bypassing
   approval (`inj.auto_approve`), self-granting/modifying permissions (`inj.self_grant`
   / `inj.self_modify`).
5. **Content items carry no tools.** A non-executable type declaring tools →
   `tool.on_content` BLOCK.
6. **Tool minimization / hidden write.** An item that claims read-only but declares write
   tools → `tool.hidden_write` BLOCK.
7. **Risk classification** (`classifyRisk`) is derived from the **known tools**, never
   claimed: destructive → `HIGH_RISK`; write + scheduled → `SCHEDULED_WRITE`; write →
   `WRITE_CAPABLE`; read → `READ_ONLY`; else `CONTENT_ONLY`. **HIGH_RISK is not
   publishable** (`risk.too_high` BLOCK; `PUBLISHABLE_MAX_RISK = SCHEDULED_WRITE`).
8. **Capability vocabulary** is validated against `PRODUCT_CAPABILITIES`; executable
   types implicitly require their capability (`agents` / `automations` / `research`).
9. **Data-movement disclosure.** Read-connector → write-connector pairs are computed and
   surfaced (`data.movement` INFO) so *"read from X, write to Y"* is always visible.

`ok` is true only when there are **no BLOCK flags**. A human reviewer **cannot approve a
version whose validation failed** (`422 validation_failed`) — automated validation is a
gate the human decision sits *on top of*, never a suggestion the human can override.

## Install ≠ grant

`installItem` creates a controlled local definition under the installer's **own**
authority and **grants no tool / connector / OAuth permission**. `allowedTools` /
`allowedConnectors` are *declarations*. At run time, the existing layers still apply
independently:

```
platform safety → org policy → user permissions → plan entitlement
   → connector scope (live connection required) → tool policy → action policy (approvals)
```

Executables install as **DRAFT** (workflows) or a disabled-by-default posture; a
write-capable agent still pauses every write for approval; a workflow still needs a
configured trigger, connection, budget, and a standing authorization before any
unattended write. See [`AGENT_LIBRARY.md`](./AGENT_LIBRARY.md) and
[`WORKFLOW_LIBRARY.md`](./WORKFLOW_LIBRARY.md).

## Tenant isolation & IDOR

`canViewItem` / `visibleItemsFilter` resolve visibility server-side: **PRIVATE**
owner-only; **ORGANIZATION** only for verified members of the publishing org;
**BIINA_CURATED** everyone; **PUBLIC** only when enabled. Org A's private/org items are
never visible or installable by Org B. A foreign or wrong-tenant id resolves to null →
404 with no existence leak. Installations, versions, and updates re-resolve ownership
(`getInstallation` checks the viewer owns the row) before any mutation.

## Version-escalation protection

An installed executable is **never silently upgraded** to a version that adds a tool,
adds a connector, raises the risk class, or changes the approval policy. `diffVersions`
marks such a change `securitySensitive`; `updateInstallation` then **requires explicit
`confirm`** (else `409 update_requires_review`, logged `library.update_blocked`).
**Existing permissions do not carry over to added capability**, and a workflow that
gains capability drops back to DRAFT. Published versions are immutable and hashed
(`configHash`) so a stored snapshot cannot be altered undetected.

## Kids / Teens restrictions

Youth experiences are curated and locked down by profile **and** by the gates above:
Kids disables connectors/agents/unrestricted web/public marketplace and uses a
`CURATED_KIDS` marketplace; Teens is stronger than adult but weaker, with safe-search
and `CURATED_TEENS`. A youth persona cannot self-select (`supervisedOnly`), and its plan
does not enable write-capable agent/workflow libraries — so a kids account cannot install
a business write agent. See [`KIDS_TEENS_EXPERIENCE.md`](./KIDS_TEENS_EXPERIENCE.md).

## Org curation

Organizations layer curation **on top of** authorization (never granting access):
`APPROVED_ONLY` install policy, `writeCapableAllowed=false`, disabling the public
marketplace for members, hiding/recommending/approving specific items, and version
pinning. Enforced in `assertInstallAllowed` + `searchItems`. See
[`ORGANIZATION_LIBRARY.md`](./ORGANIZATION_LIBRARY.md).

## Kill switches

Env-read, never widened by item content or persona (`config.ts`): `LIBRARY_ENABLED`,
`LIBRARY_INSTALLATION_ENABLED`, `PUBLIC_LIBRARY_ENABLED` (off), `PUBLIC_CREATOR_
PUBLISHING_ENABLED` (off), `PAID_MARKETPLACE_ENABLED` (off, not implemented),
`EXPERIENCE_PROFILES_ENABLED`, `LIBRARY_SUSPENDED_ITEMS`. Hard caps
(`HARD_MAX_INSTALLED_AGENTS`/`_WORKFLOWS = 200`) cannot be raised by a plan.

## Audit & security logging

Metadata-only events (never item content, credentials, or private data):
`experience.changed`; `library.item_created` / `item_updated`; `library.submitted` /
`approved` / `published` / `rejected` / `changes_requested` / `suspended` /
`deprecated`; `library.installed` / `updated_install` / `update_blocked` /
`uninstalled` / `forked`; `library.org_policy_changed` / `org_curation_changed`. Admin
observability (`libraryOverview`, `GET /api/admin/library`) is metadata + kill-switch
state only. Provider base URLs and keys stay server-side and are never logged.

## Security test matrix

| Threat | Structural defense | Expected outcome |
|---|---|---|
| Malicious write agent submitted | deterministic validation **and** runtime `ActionPolicyService` | blocked at review; even if published, blocked at runtime by policy/approval |
| Hidden write tool in a "read-only" item | `tool.hidden_write` (claim vs declared writes) | BLOCK at validation |
| Arbitrary `http(s)://` endpoint or code in instructions | `net.url` / `code.*` scan | REJECTED at validation |
| Unknown / invented tool id | `isKnownTool` allowlist | `tool.unknown` BLOCK |
| Destructive (HIGH_RISK) item submitted | `PUBLISHABLE_MAX_RISK = SCHEDULED_WRITE` | not publishable (`risk.too_high` / `422 risk_too_high`) |
| Install to gain a permission (e.g. Gmail send) | install ≠ grant; no OAuth/scope granted | no permission; run still needs connection + policy + approval |
| Update that adds a write tool applied silently | `diffVersions` securitySensitive + explicit confirm | `409 update_requires_review`; workflow → DRAFT; no carryover |
| Cross-tenant read/install (Org B sees Org A) | `canViewItem` / `visibleItemsFilter` / ownership re-check | invisible → 404, no existence leak |
| Kids account installs a business write agent | youth profile + plan gating (no agent/write library) + supervised | refused |
| Prompt-injection / self-escalation phrasing | `INJECTION_PATTERNS` scan | BLOCK at validation |
| Human approves a validation-failing item | `validationResult.ok === false` hard gate in `decideReview` | `422 validation_failed` |
| Item content tries to widen a kill switch or persona | switches read from env only; persona is not a boundary | no effect |
