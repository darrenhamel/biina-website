import { createHash } from 'node:crypto';
import { getAgentTool, isKnownTool } from '@/server/agent/tool-catalog';
import { DEFINITION_SCHEMAS, RISK_ORDER, PRODUCT_CAPABILITIES, isExecutableType, type LibraryItemType, type RiskLevel } from './types';
import type { ProductCapability } from '@/config/experience-profiles';

/**
 * LibraryReviewService — DETERMINISTIC validation. This is the primary marketplace
 * safety gate; it does NOT rely on an AI judgement. It runs at submit time and again
 * before publish. Everything it can prove structurally, it proves here:
 *
 *   • the definition matches its typed schema (no unknown/executable structures);
 *   • every declared tool exists in the trusted AGENT_TOOLS allowlist (no arbitrary
 *     http/shell/api tool, no invented tool id);
 *   • no arbitrary code or raw network endpoint is embedded in instructions/prompts;
 *   • declared risk matches the actual tool set (tool-minimization / hidden-write);
 *   • prompt-injection / self-escalation / exfiltration phrasing is flagged;
 *   • data-movement (read-from → write-to connectors) is disclosed.
 *
 * HIGH_RISK executable patterns are not publishable in Phase 16 (structural rule).
 */

export interface ValidationFlag {
  code: string;
  severity: 'INFO' | 'WARN' | 'BLOCK';
  message: string;
}

export interface ValidationResult {
  ok: boolean; // no BLOCK flags
  riskLevel: RiskLevel;
  requiredTools: string[];
  requiredConnectors: string[];
  requiredCapabilities: ProductCapability[];
  writeTools: string[];
  readTools: string[];
  destructiveTools: string[];
  dataMovement: Array<{ from: string; to: string }>;
  flags: ValidationFlag[];
  /** Normalized definition (post-schema-parse) safe to snapshot. */
  normalized?: Record<string, unknown>;
}

// Patterns that must never appear as executable content in a DATA-only item.
const CODE_PATTERNS: Array<{ re: RegExp; code: string; message: string }> = [
  { re: /<script\b/i, code: 'code.script', message: 'Embedded <script> is not allowed.' },
  { re: /\bfunction\s*\(|=>\s*\{|\beval\s*\(|\bnew\s+Function\b/i, code: 'code.js', message: 'Embedded JavaScript is not allowed.' },
  { re: /\b(import|exec|subprocess|os\.system|require)\s*\(/i, code: 'code.exec', message: 'Embedded executable code is not allowed.' },
  { re: /\b(curl|wget|bash|sh|powershell)\b\s+[-a-z]/i, code: 'code.shell', message: 'Embedded shell commands are not allowed.' },
  { re: /https?:\/\/[^\s)"']+/i, code: 'net.url', message: 'Raw network endpoints are not allowed in item content; use registered connectors/tools.' },
];

// Prompt-injection / self-escalation / exfiltration phrasing.
const INJECTION_PATTERNS: Array<{ re: RegExp; code: string; message: string }> = [
  { re: /ignore (all |the |your )?(previous |platform |biina|system )?(rules|policy|policies|instructions|guardrails)/i, code: 'inj.ignore_policy', message: 'Attempts to override platform policy.' },
  { re: /\b(hide|conceal|don'?t (tell|show|reveal))\b.{0,40}\b(action|user|from the user|activity)/i, code: 'inj.hide_actions', message: 'Attempts to hide actions from the user.' },
  { re: /(send|exfiltrate|email|upload|post|leak).{0,40}(confidential|private|secret|credentials|api key|files|data).{0,40}(external|outside|attacker|third[- ]party)/i, code: 'inj.exfiltrate', message: 'Attempts to exfiltrate data externally.' },
  { re: /(auto[- ]?approve|approve yourself|bypass approval|skip approval|self[- ]approve)/i, code: 'inj.auto_approve', message: 'Attempts to bypass the approval system.' },
  { re: /(grant|give) (yourself|itself).{0,20}(permission|access|scope|tool)/i, code: 'inj.self_grant', message: 'Attempts self-permission escalation.' },
  { re: /(modify|change|edit).{0,20}(your own|its own|the).{0,20}(permission|policy|scope|tool)/i, code: 'inj.self_modify', message: 'Attempts self-modification of permissions.' },
];

function scanText(text: string, patterns: typeof CODE_PATTERNS, flags: ValidationFlag[]): void {
  for (const p of patterns) if (p.re.test(text)) flags.push({ code: p.code, severity: 'BLOCK', message: p.message });
}

/** Collect the human-authored text of a definition (instructions/prompt/goal/objective). */
function definitionText(itemType: LibraryItemType, def: Record<string, unknown>): string {
  const parts: string[] = [];
  for (const k of ['instructions', 'promptTemplate', 'goal', 'agentInstructions', 'objective', 'summary']) {
    const v = def[k];
    if (typeof v === 'string') parts.push(v);
  }
  return parts.join('\n');
}

function declaredTools(itemType: LibraryItemType, def: Record<string, unknown>): string[] {
  const t = def.allowedTools;
  return Array.isArray(t) ? (t as string[]) : [];
}

function declaredConnectors(itemType: LibraryItemType, def: Record<string, unknown>): string[] {
  const out = new Set<string>();
  for (const k of ['allowedConnectors', 'requiredConnectors']) {
    const v = def[k];
    if (Array.isArray(v)) for (const c of v as string[]) out.add(c);
  }
  return [...out];
}

/** Map a set of tool ids to a risk classification using the trusted catalog. */
export function classifyRisk(itemType: LibraryItemType, toolIds: string[], scheduled: boolean): { risk: RiskLevel; read: string[]; write: string[]; destructive: string[] } {
  const read: string[] = [];
  const write: string[] = [];
  const destructive: string[] = [];
  for (const id of toolIds) {
    const tool = getAgentTool(id);
    if (!tool) continue; // unknown handled elsewhere as a BLOCK
    if (tool.risk === 'DESTRUCTIVE') destructive.push(id);
    if (tool.kind === 'write') write.push(id);
    else read.push(id);
  }
  let risk: RiskLevel;
  if (destructive.length) risk = 'HIGH_RISK';
  else if (write.length && scheduled) risk = 'SCHEDULED_WRITE';
  else if (write.length) risk = 'WRITE_CAPABLE';
  else if (read.length) risk = 'READ_ONLY';
  else risk = 'CONTENT_ONLY';
  return { risk, read, write, destructive };
}

export interface ValidateInput {
  itemType: LibraryItemType;
  definition: unknown;
  /** The item's declared risk/read-only claim (from title/description or explicit field). */
  claimedReadOnly?: boolean;
  /** Whether the item's suggested trigger is a schedule (affects SCHEDULED_WRITE). */
  scheduled?: boolean;
  /** Product capabilities the item declares it needs (validated against the vocabulary). */
  declaredCapabilities?: string[];
}

export function validateDefinition(input: ValidateInput): ValidationResult {
  const flags: ValidationFlag[] = [];
  const schema = DEFINITION_SCHEMAS[input.itemType];
  const parsed = schema.safeParse(input.definition);
  if (!parsed.success) {
    return {
      ok: false,
      riskLevel: 'CONTENT_ONLY',
      requiredTools: [],
      requiredConnectors: [],
      requiredCapabilities: [],
      writeTools: [],
      readTools: [],
      destructiveTools: [],
      dataMovement: [],
      flags: [{ code: 'schema.invalid', severity: 'BLOCK', message: 'Configuration does not match the required schema for this item type.' }],
    };
  }
  const def = parsed.data as Record<string, unknown>;

  // 1) Arbitrary code / raw endpoints in authored text → BLOCK.
  const text = definitionText(input.itemType, def);
  scanText(text, CODE_PATTERNS, flags);

  // 2) Prompt-injection / self-escalation / exfiltration phrasing → BLOCK.
  scanText(text, INJECTION_PATTERNS, flags);

  // 3) Tool allowlist — every declared tool must exist in AGENT_TOOLS. Unknown → BLOCK.
  const tools = declaredTools(input.itemType, def);
  const unknownTools = tools.filter((t) => !isKnownTool(t));
  for (const t of unknownTools) flags.push({ code: 'tool.unknown', severity: 'BLOCK', message: `Unknown or disallowed tool "${t}". Only registered tools are permitted.` });

  // Content-only item types must not carry tools at all.
  if (!isExecutableType(input.itemType) && tools.length) {
    flags.push({ code: 'tool.on_content', severity: 'BLOCK', message: 'This item type may not declare executable tools.' });
  }

  // 4) Risk classification from the KNOWN tools.
  const known = tools.filter(isKnownTool);
  const { risk, read, write, destructive } = classifyRisk(input.itemType, known, input.scheduled === true);

  // 5) Tool minimization / hidden-write: a "read-only"-claimed item requesting writes.
  if (input.claimedReadOnly && write.length) {
    flags.push({ code: 'tool.hidden_write', severity: 'BLOCK', message: `Item claims read-only but requests write tools: ${write.join(', ')}.` });
  }

  // 6) HIGH_RISK (destructive) is not publishable in Phase 16.
  if (RISK_ORDER[risk] > RISK_ORDER['SCHEDULED_WRITE']) {
    flags.push({ code: 'risk.too_high', severity: 'BLOCK', message: 'High-risk (destructive) items cannot be published in this phase.' });
  }

  // 7) Capability vocabulary check.
  const requiredCapabilities: ProductCapability[] = [];
  for (const c of input.declaredCapabilities ?? []) {
    if ((PRODUCT_CAPABILITIES as string[]).includes(c)) requiredCapabilities.push(c as ProductCapability);
    else flags.push({ code: 'capability.unknown', severity: 'WARN', message: `Unknown capability "${c}" ignored.` });
  }
  // Executable items implicitly need the matching capability.
  if (input.itemType === 'AGENT_TEMPLATE' && !requiredCapabilities.includes('agents')) requiredCapabilities.push('agents');
  if (input.itemType === 'WORKFLOW_TEMPLATE' && !requiredCapabilities.includes('automations')) requiredCapabilities.push('automations');
  if (input.itemType === 'RESEARCH_TEMPLATE' && !requiredCapabilities.includes('research')) requiredCapabilities.push('research');

  // 8) Data-movement disclosure: read connector(s) → write connector(s).
  const connectors = declaredConnectors(input.itemType, def);
  const readConns = new Set<string>();
  const writeConns = new Set<string>();
  for (const id of known) {
    const tool = getAgentTool(id);
    if (!tool) continue;
    if (tool.kind === 'write') writeConns.add(tool.connectorSlug);
    else readConns.add(tool.connectorSlug);
  }
  const dataMovement: Array<{ from: string; to: string }> = [];
  for (const from of readConns) for (const to of writeConns) if (from !== to) dataMovement.push({ from, to });
  if (dataMovement.length) flags.push({ code: 'data.movement', severity: 'INFO', message: `Moves data: ${dataMovement.map((m) => `${m.from} → ${m.to}`).join(', ')}.` });

  // 9) Missing descriptions on executables → WARN.
  if (isExecutableType(input.itemType) && text.trim().length < 20) {
    flags.push({ code: 'meta.thin', severity: 'WARN', message: 'Item instructions are very short; add a clear description of what it does.' });
  }

  const ok = !flags.some((f) => f.severity === 'BLOCK');
  return {
    ok,
    riskLevel: risk,
    requiredTools: known,
    requiredConnectors: connectors,
    requiredCapabilities,
    writeTools: write,
    readTools: read,
    destructiveTools: destructive,
    dataMovement,
    flags,
    normalized: def,
  };
}

/** A stable content hash for a published configuration snapshot. */
export function configHash(itemType: string, version: number, definition: unknown): string {
  const canonical = JSON.stringify({ itemType, version, definition }, Object.keys({ itemType, version, definition }).sort());
  return createHash('sha256').update(canonical).digest('hex').slice(0, 32);
}

/**
 * Compare two versions' capability surface. A version that ADDS a tool/connector, or
 * raises the risk class, or changes the approval policy, is a security-sensitive
 * change that requires explicit re-review — an existing install is never silently
 * upgraded to it.
 */
export interface VersionDiff {
  newTools: string[];
  newConnectors: string[];
  riskIncreased: boolean;
  approvalPolicyChanged: boolean;
  securitySensitive: boolean;
}

export function diffVersions(
  prev: { requiredTools: string[]; requiredConnectors: string[]; riskLevel: RiskLevel; approvalPolicy?: string | null },
  next: { requiredTools: string[]; requiredConnectors: string[]; riskLevel: RiskLevel; approvalPolicy?: string | null },
): VersionDiff {
  const newTools = next.requiredTools.filter((t) => !prev.requiredTools.includes(t));
  const newConnectors = next.requiredConnectors.filter((c) => !prev.requiredConnectors.includes(c));
  const riskIncreased = RISK_ORDER[next.riskLevel] > RISK_ORDER[prev.riskLevel];
  const approvalPolicyChanged = (prev.approvalPolicy ?? null) !== (next.approvalPolicy ?? null);
  const securitySensitive = newTools.length > 0 || newConnectors.length > 0 || riskIncreased || approvalPolicyChanged;
  return { newTools, newConnectors, riskIncreased, approvalPolicyChanged, securitySensitive };
}
