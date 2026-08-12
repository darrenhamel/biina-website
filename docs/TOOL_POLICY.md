# BIINA.ai — Tool Policy & Risk

How BIINA decides whether a proposed agent action is **allowed, requires approval,
or is denied**. Risk is classified centrally by BIINA — **never by the model** — and
the default policy is deliberately conservative. Code: `apps/web/src/server/agent/`
(`risk.ts`, `tool-catalog.ts`, `policy.ts`, `policies-store.ts`). Companion:
`AGENT_ARCHITECTURE.md`, `AGENT_SECURITY.md`, `ACTION_APPROVALS.md`.

## Risk taxonomy (`risk.ts`)

Every tool carries one `AgentRiskLevel`. The model never sets or changes it — BIINA
does, in the catalog.

| Risk level | Meaning | Default policy |
|---|---|---|
| `READ_ONLY` | no side effect (search / read) | **ALLOW** |
| `REVERSIBLE_WRITE` | a write that can be undone (draft, CRM update, event update) | **REQUIRE_APPROVAL** |
| `EXTERNAL_COMMUNICATION` | leaves BIINA to a third party (send email, post Slack, create event) | **REQUIRE_APPROVAL** |
| `FINANCIAL_OR_COMMITMENT` | money or a binding commitment | **DENY** |
| `DESTRUCTIVE` | deletes / cancels (delete file, cancel event) | **DENY** |
| `HIGH_RISK` | anything otherwise dangerous | **DENY** |

`DEFAULT_RISK_POLICY` encodes exactly this map. A separate `Reversibility` tag
(`REVERSIBLE` · `PARTIALLY_REVERSIBLE` · `IRREVERSIBLE`) rides each tool for previews
and readiness for compensating actions (`AGENT_EXECUTION.md`), independent of the
risk decision.

**Phase 11 posture:** anything that leaves BIINA needs human approval; destructive
and financial actions are denied outright.

## The tool catalog — a strict allowlist (`tool-catalog.ts`)

`AGENT_TOOLS` is the entire surface the model may ever request. Each entry has a
strict **Zod input schema** (unknown fields rejected), a connector slug + operation,
a kind (`read`/`write`), a risk level, reversibility, and a preview kind. There is
**deliberately no arbitrary-HTTP, arbitrary-API, or shell tool** — only these
entries can run, which structurally removes SSRF and generic exfiltration
(`AGENT_SECURITY.md`).

Notable entries: `gmail.createDraft` is a `REVERSIBLE_WRITE` (nothing sent) while
`gmail.send` is `EXTERNAL_COMMUNICATION`; `calendar.cancel` and `drive.delete` are
`DESTRUCTIVE` and registered **only** so policy can DENY them explicitly. `mock.*`
and `crm.*` power the offline path.

### Context-aware filtering (`buildToolCatalog`)

The model never even sees a tool it could not use. `buildToolCatalog` returns only
tools that:

1. exist in the allowlist **and are not killed** (`AGENT_DISABLED_TOOLS`);
2. map to a connector the user has an **ACTIVE connection** for;
3. are permitted by **plan** (`connectorsEnabled`), **mode** (CHAT exposes nothing;
   writes hidden when the mode disallows them), and the **effective policy's
   hard-denies**.

Availability is never left to "the model choosing not to use" a visible tool.
Read-tool exposure additionally requires the connection to have granted the read
capability; write *approval* is decided at execution, not by hiding the tool.

Tool output is **normalized** (`NormalizedToolResult`) before it reaches the model —
never a giant raw provider payload.

## The policy decision (`policy.ts` → `decidePolicy`)

`decidePolicy` is the single authority returning `ALLOW` / `REQUIRE_APPROVAL` /
`DENY` with a reason. Order:

0. **CHAT mode** never uses tools → DENY.
1. **Kill switches** — a killed tool, or `agentEnabled=false`, → DENY.
2. **Risk default** — start from `DEFAULT_RISK_POLICY[tool.risk]`.
3. **Writes** — if `agentWriteActionsEnabled()` is off → DENY; if policy
   `writeActionsEnabled` is off → DENY; if the **category switch** for the connector
   is off → DENY. Otherwise a write is floored at `REQUIRE_APPROVAL` (never runs
   silently).
4. **Per-tool override** — a policy override can `DENY` or raise to
   `REQUIRE_APPROVAL`. An `ALLOW` override is **ignored** for writes; it cannot lower
   the floor.
5. **Cross-connector transfer** — if the action moves data between two connectors
   and policy says `DENY`, deny; otherwise raise to `REQUIRE_APPROVAL`.

Every step can only **tighten** the decision (`tighten` picks the more restrictive of
two). Nothing loosens a safety boundary.

## Policy precedence — Platform → Organization → User

Policies exist at three scopes (`agent_policies`, scope `PLATFORM` / `ORGANIZATION` /
`USER`). The **effective policy** is the **most restrictive combination**
(`policies-store.ts` → `resolveEffectivePolicy`):

```
Platform (safety ceiling) → Organization → User
        each layer can only turn things OFF or raise a tool to REQUIRE_APPROVAL / DENY
```

- A stricter scope can disable the agent, disable writes globally, disable a category
  (email / calendar / slack / crm), lower `maxStepsPerSession`, tighten
  `crossConnectorTransfer`, or tighten a per-tool override. It can **never** force a
  capability ON or loosen the platform ceiling.
- Boolean flags fold with logical AND (`false` anywhere wins); step caps fold to the
  minimum; per-tool overrides and cross-connector transfer fold to the more
  restrictive value.
- The permissive base is only a *starting point* the scopes tighten; it is not a
  grant the model can reach on its own — a write is still floored at approval and
  still needs the global write switch.

### Effective policy shape

`EffectivePolicy` carries: `agentEnabled`, `writeActionsEnabled`, the four category
switches, `maxStepsPerSession`, merged `toolOverrides`, and `crossConnectorTransfer`
(default `REQUIRE_APPROVAL` — never silent).

## Per-tool overrides & category switches

- **Category switches** (`categoryDisabled`) are master off-switches for a
  connector's writes: `emailSendingEnabled`, `calendarActionsEnabled`,
  `slackPostingEnabled`, `crmWritesEnabled`. Off → every write to that connector is
  DENIED regardless of the tool.
- **Per-tool overrides** target one tool id, e.g. `{"gmail.send":"DENY"}`. They can
  only tighten (see above).

Policies are set via `setAgentPolicy` (audited) through
`PUT /api/admin/agents/policy` (platform, admin-only) and
`PUT /api/orgs/[slug]/agent-policy` (org, managers only). The `agentPolicySchema`
accepts only tightening-shaped patches.

## Cross-connector transfer

Moving data from one connector into a write on another (e.g. Drive → email) is
**never silent**. When `crossConnector` is set on a write, the decision is raised to
at least `REQUIRE_APPROVAL`, and a policy of `DENY` blocks it entirely. This closes
the classic read-here-send-there exfiltration path at the policy layer, on top of the
structural allowlist defense (`AGENT_SECURITY.md`).
