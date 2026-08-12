# BIINA.ai — Agent Library

An **AgentTemplate** is a shareable, installable assistant definition. Installing one
creates a **local `AgentDefinition` under the installer's own authority** — it **grants
no tool, connector, or OAuth permission by itself**. It only *declares* what the agent
would need; actually running it still requires live connections, the tool policy, and
Phase 11 approvals. Code: `apps/web/src/server/library/installations.ts`,
`server/library/types.ts` (`agentTemplateSchema`). Companion docs:
[`LIBRARY_ARCHITECTURE.md`](./LIBRARY_ARCHITECTURE.md),
[`AGENT_ARCHITECTURE.md`](./AGENT_ARCHITECTURE.md),
[`ACTION_APPROVALS.md`](./ACTION_APPROVALS.md), [`TOOL_POLICY.md`](./TOOL_POLICY.md),
[`LIBRARY_SECURITY.md`](./LIBRARY_SECURITY.md).

## The template definition

`agentTemplateSchema` (strict Zod, DATA only):

- `instructions` — the agent's brief (1–20 000 chars, scanned for code/injection at
  review).
- `allowedTools` — declared tool ids (≤24), each validated against the trusted
  `AGENT_TOOLS` catalog. An **unknown tool is a hard BLOCK** — there is no arbitrary
  HTTP / shell / API tool.
- `allowedConnectors` — declared connector slugs (≤12).
- `defaultModelProfile` — a logical product model identity (optional).
- `maxSteps` / `maxToolCalls` — bounded execution caps (optional).
- `approvalPolicy` — `ASK_EVERY_WRITE` / `ASK_HIGH_RISK_ONLY` / `READ_ONLY_AUTOMATIC`.
- `inputFields` — declarative typed inputs (no expressions).

Risk is **derived** from the declared tools (read-only → `READ_ONLY`; write tools →
`WRITE_CAPABLE`; destructive → `HIGH_RISK`, which is not publishable). An item that
claims read-only but declares write tools is rejected as a hidden-write. See
[`LIBRARY_SECURITY.md`](./LIBRARY_SECURITY.md).

## Install = a declared local copy, not a grant

`installItem` (for an `AGENT_TEMPLATE`) inserts a new `AgentDefinition`:

- owned by the installer (personal) or the active organization;
- `instructions` / `allowedTools` / `allowedConnectors` / `defaultModelProfile` /
  `maxSteps` / `maxToolCalls` / `approvalPolicy` copied from the **immutable published
  snapshot**;
- `enabled: true`, and the installation row records `installedDefinitionType = AGENT`.

Crucially, **no live connection, OAuth scope, or tool permission is granted here.** The
`allowedTools` / `allowedConnectors` are *declarations of intent*. At run time the Phase
11 engine still requires:

1. an **active connection** for each connector the tool needs
   ([`CONNECTOR_SECURITY.md`](./CONNECTOR_SECURITY.md));
2. the effective **tool policy** to ALLOW / REQUIRE_APPROVAL / DENY the tool
   (Platform → Org → User, most-restrictive-wins — [`TOOL_POLICY.md`](./TOOL_POLICY.md));
3. **human approval** for every write, per the risk taxonomy
   ([`ACTION_APPROVALS.md`](./ACTION_APPROVALS.md)).

So a *Sales Analyst* agent installed with `gmail.read` still reads nothing until the
user connects Gmail and the policy permits it; a write-capable agent still pauses every
write for approval. **Installing an agent never bypasses a single one of these gates.**

## Pre-install disclosure

Before installing, the UI shows `installDisclosure`: `requiredTools`,
`requiredConnectors`, which are already `connectedConnectors` vs `missingConnectors`,
`requiredCapabilities`, `requiredPlans`, `externalWrites` (write/communication tools),
`dataMovement` (read-connector → write-connector pairs), and `blockers`. The installer
sees exactly what the agent *would* be able to do — and what is still missing — before
committing.

## Approval defaults

The template's `approvalPolicy` is a **default**, and it can only make execution *more*
cautious than the platform baseline. When a snapshot omits it, the installed agent
defaults to `ASK_EVERY_WRITE` (with `maxSteps` 8 / `maxToolCalls` 16 defaults). No
template can set a policy that auto-approves external writes — the platform risk
taxonomy and write switch (`agentWriteActionsEnabled`, off by default) still govern
whether writes execute at all.

## Caps & kill switches

- **Plan gating**: install requires `plan.libraryEnabled` **and**
  `plan.agentLibraryEnabled`; otherwise the disclosure lists a blocker and install is
  refused.
- **Install caps**: the installed-agent count is capped at
  `min(plan.maxInstalledAgents, HARD_MAX_INSTALLED_AGENTS=200)`; reaching it returns
  `403 agent_cap`.
- **Org policy**: an org can forbid write-capable installs (`writeCapableAllowed=false`)
  or require `APPROVED_ONLY` items ([`ORGANIZATION_LIBRARY.md`](./ORGANIZATION_LIBRARY.md)).
- **Platform**: `LIBRARY_INSTALLATION_ENABLED` and `LIBRARY_SUSPENDED_ITEMS` can stop
  installs entirely or per item.

## Updating & uninstalling

- An installed agent is **never silently upgraded** to a version that adds a tool /
  connector / risk / approval change — a security-sensitive update needs an explicit
  confirm, and existing permissions do **not** carry over to newly-added capabilities
  ([`LIBRARY_PUBLISHING.md`](./LIBRARY_PUBLISHING.md#version-updates--re-review)).
- **Uninstall** disables the local `AgentDefinition` (`enabled:false`) and marks the
  installation `UNINSTALLED`. It does **not** disconnect OAuth, delete source data, or
  touch unrelated agents.

Events: `library.installed` / `library.updated_install` / `library.update_blocked` /
`library.uninstalled` (metadata only). Runtime blocks are enforced and audited by the
agent engine ([`AGENT_SECURITY.md`](./AGENT_SECURITY.md),
[`AGENT_AUDITING.md`](./AGENT_AUDITING.md)) — a malicious agent that passed neither
review nor the runtime `ActionPolicyService` still cannot act.
