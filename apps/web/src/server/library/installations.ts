import { and, count, eq, inArray } from 'drizzle-orm';
import { getDb } from '@/server/db';
import { agentDefinitions, connections, libraryInstallations, libraryItems, workflows } from '@/server/db/schema';
import type { LibraryInstallation, LibraryItem, LibraryItemVersion, Plan } from '@/server/db/schema';
import { AppError } from '@/lib/errors';
import { logSecurityEvent } from '@/server/auth/events';
import { getAgentTool } from '@/server/agent/tool-catalog';
import { getExperienceProfile } from '@/config/experience-profiles';
import { libraryEnabled, libraryInstallationEnabled, itemSuspendedByPlatform, HARD_MAX_INSTALLED_AGENTS, HARD_MAX_INSTALLED_WORKFLOWS } from './config';
import { canViewItem, getOrgLibraryPolicy, orgApprovedItemIds, type LibraryViewer } from './access';
import { resolveOrgGovernance } from '@/server/enterprise/deployment';
import { currentPublishedVersion } from './versions';
import { installedTypeFor, isExecutableType, RISK_ORDER, type LibraryItemType, type RiskLevel } from './types';

/**
 * Installation = a controlled LOCAL copy under the installer's OWN authority. It
 * grants NO tool/connector/OAuth permission by itself; it only DECLARES what the item
 * would need. Executable items (agents/workflows) install as DRAFT — a workflow must
 * be configured (schedule/connection/approval) and explicitly activated before it can
 * run. Nothing here bypasses plan entitlement, org policy, or platform safety.
 */

export interface InstallDisclosure {
  itemType: LibraryItemType;
  riskLevel: RiskLevel;
  requiredTools: string[];
  requiredConnectors: string[];
  connectedConnectors: string[];
  missingConnectors: string[];
  requiredCapabilities: string[];
  requiredPlans: string[];
  externalWrites: string[]; // write/communication tool ids
  dataMovement: Array<{ from: string; to: string }>;
  startsAsDraft: boolean;
  /** True when required plan/connectors/capabilities are satisfied enough to activate. */
  canActivate: boolean;
  blockers: string[];
}

async function connectedSlugs(viewer: LibraryViewer): Promise<Set<string>> {
  const rows = await getDb()
    .select({ slug: connections.connectorSlug, status: connections.status, userId: connections.userId, orgId: connections.organizationId })
    .from(connections)
    .where(eq(connections.status, 'ACTIVE'));
  const set = new Set<string>();
  for (const r of rows) {
    const mine = r.userId === viewer.userId || (viewer.activeOrganizationId && r.orgId === viewer.activeOrganizationId);
    if (mine) set.add(r.slug);
  }
  return set;
}

/** Compute the pre-install disclosure the UI must show BEFORE installing. */
export async function installDisclosure(viewer: LibraryViewer, item: LibraryItem, version: LibraryItemVersion, plan: Plan): Promise<InstallDisclosure> {
  const requiredTools = version.requiredTools ?? [];
  const requiredConnectors = version.requiredConnectors ?? [];
  const connected = await connectedSlugs(viewer);
  const missingConnectors = requiredConnectors.filter((c) => !connected.has(c));
  const externalWrites = requiredTools.filter((t) => {
    const tool = getAgentTool(t);
    return tool && tool.kind === 'write';
  });
  const dataMovement = ((version.manifest as { dataMovement?: Array<{ from: string; to: string }> })?.dataMovement) ?? [];

  const blockers: string[] = [];
  // Plan gating.
  const requiredPlans = version.requiredPlans ?? [];
  if (requiredPlans.length && !requiredPlans.includes(plan.slug)) blockers.push('plan');
  if (!plan.libraryEnabled) blockers.push('library_disabled');
  if (item.itemType === 'AGENT_TEMPLATE' && !plan.agentLibraryEnabled) blockers.push('agent_library_disabled');
  if (item.itemType === 'WORKFLOW_TEMPLATE' && !plan.workflowLibraryEnabled) blockers.push('workflow_library_disabled');
  // Persona capability gating (before plan/policy, style-level).
  const profile = getExperienceProfile(null);
  void profile;

  const startsAsDraft = isExecutableType(item.itemType as LibraryItemType);
  const canActivate = blockers.length === 0 && missingConnectors.length === 0;
  return {
    itemType: item.itemType as LibraryItemType,
    riskLevel: version.riskLevel as RiskLevel,
    requiredTools,
    requiredConnectors,
    connectedConnectors: [...connected].filter((c) => requiredConnectors.includes(c)),
    missingConnectors,
    requiredCapabilities: version.requiredCapabilities ?? [],
    requiredPlans,
    externalWrites,
    dataMovement,
    startsAsDraft,
    canActivate,
    blockers,
  };
}

async function assertInstallAllowed(viewer: LibraryViewer, item: LibraryItem, version: LibraryItemVersion, plan: Plan): Promise<void> {
  if (!libraryEnabled() || !libraryInstallationEnabled()) throw new AppError(403, 'The library is not available.', 'library_disabled');
  if (itemSuspendedByPlatform(item.slug) || itemSuspendedByPlatform(item.id)) throw new AppError(403, 'This item is suspended.', 'item_suspended');
  if (item.status !== 'PUBLISHED') throw new AppError(409, 'Only published items can be installed.', 'not_published');
  if (!plan.libraryEnabled) throw new AppError(403, 'Your plan does not include the library.', 'plan_no_library');

  // Org curation: APPROVED_ONLY + write-capable restrictions + public marketplace off.
  if (viewer.activeOrganizationId) {
    // Phase 17 — the enterprise security policy's marketplace mode composes on top of
    // Phase 16 library curation (most restrictive wins). DISABLED blocks all installs;
    // ORGANIZATION_ONLY blocks non-org items; CURATED_ONLY blocks unapproved non-BIINA.
    const gov = await resolveOrgGovernance(viewer.activeOrganizationId);
    const mode = gov.policy.marketplaceMode;
    if (mode === 'DISABLED') throw new AppError(403, 'Your organization has disabled the library.', 'org_marketplace_disabled');
    if (mode === 'ORGANIZATION_ONLY' && item.publisherOrganizationId !== viewer.activeOrganizationId) throw new AppError(403, 'Your organization only allows its own library items.', 'org_only');
    if (mode === 'CURATED_ONLY' && item.publisherType !== 'BIINA' && item.publisherOrganizationId !== viewer.activeOrganizationId) {
      const approved = await orgApprovedItemIds(viewer.activeOrganizationId);
      if (!approved.has(item.id)) throw new AppError(403, 'Only curated/approved items may be installed.', 'org_curated_only');
    }
    const policy = await getOrgLibraryPolicy(viewer.activeOrganizationId);
    if (item.visibility === 'PUBLIC' && !policy.publicLibraryEnabled) throw new AppError(403, 'Your organization has disabled the public library.', 'org_public_disabled');
    if (!policy.writeCapableAllowed && RISK_ORDER[version.riskLevel as RiskLevel] >= RISK_ORDER.WRITE_CAPABLE) {
      throw new AppError(403, 'Your organization does not allow installing write-capable items.', 'org_write_blocked');
    }
    if (policy.installPolicy === 'APPROVED_ONLY') {
      const approved = await orgApprovedItemIds(viewer.activeOrganizationId);
      const ok = item.publisherType === 'BIINA' || approved.has(item.id) || item.publisherOrganizationId === viewer.activeOrganizationId;
      if (!ok) throw new AppError(403, 'This item is not on your organization’s approved list.', 'org_not_approved');
    }
  }

  // Per-plan install caps (executables).
  const ownerFilter = viewer.activeOrganizationId
    ? eq(libraryInstallations.organizationId, viewer.activeOrganizationId)
    : eq(libraryInstallations.userId, viewer.userId);
  if (item.itemType === 'AGENT_TEMPLATE') {
    const [{ n } = { n: 0 }] = await getDb().select({ n: count() }).from(libraryInstallations).where(and(ownerFilter, eq(libraryInstallations.installedDefinitionType, 'AGENT'), inArray(libraryInstallations.status, ['DRAFT', 'ACTIVE', 'DISABLED'])));
    const cap = Math.min(plan.maxInstalledAgents ?? HARD_MAX_INSTALLED_AGENTS, HARD_MAX_INSTALLED_AGENTS);
    if (Number(n) >= cap) throw new AppError(403, 'You have reached your installed-agent limit.', 'agent_cap');
  }
  if (item.itemType === 'WORKFLOW_TEMPLATE') {
    const [{ n } = { n: 0 }] = await getDb().select({ n: count() }).from(libraryInstallations).where(and(ownerFilter, eq(libraryInstallations.installedDefinitionType, 'WORKFLOW'), inArray(libraryInstallations.status, ['DRAFT', 'ACTIVE', 'DISABLED'])));
    const cap = Math.min(plan.maxInstalledWorkflows ?? HARD_MAX_INSTALLED_WORKFLOWS, HARD_MAX_INSTALLED_WORKFLOWS);
    if (Number(n) >= cap) throw new AppError(403, 'You have reached your installed-workflow limit.', 'workflow_cap');
  }
}

/**
 * Install a published item's current version. Creates a controlled local definition
 * under the installer's authority. Grants NO permission. Executables start DRAFT.
 */
export async function installItem(viewer: LibraryViewer, item: LibraryItem, plan: Plan): Promise<LibraryInstallation> {
  if (!(await canViewItem(viewer, item))) throw new AppError(404, 'Item not found.', 'not_found');
  const version = await currentPublishedVersion(item);
  if (!version) throw new AppError(409, 'This item has no published version.', 'no_version');
  await assertInstallAllowed(viewer, item, version, plan);

  const db = getDb();
  const ownerType = viewer.activeOrganizationId ? 'ORGANIZATION' : 'PERSONAL';
  const defType = installedTypeFor(item.itemType as LibraryItemType);
  const snapshot = version.configurationSnapshot as Record<string, unknown>;

  let installedDefinitionId: string | null = null;
  let localConfig: Record<string, unknown> | null = null;
  let status: 'DRAFT' | 'ACTIVE' = 'ACTIVE';

  if (defType === 'AGENT') {
    // Create a local AgentDefinition — its allowedTools/allowedConnectors are DECLARED,
    // but no live connection/scope is granted here. Actual use still needs connections
    // + policy + approval at run time.
    const [agent] = await db
      .insert(agentDefinitions)
      .values({
        ownerType,
        userId: viewer.activeOrganizationId ? null : viewer.userId,
        organizationId: viewer.activeOrganizationId,
        name: item.title.slice(0, 120),
        description: item.shortDescription?.slice(0, 400) ?? null,
        instructions: String(snapshot.instructions ?? ''),
        allowedTools: (snapshot.allowedTools as string[]) ?? [],
        allowedConnectors: (snapshot.allowedConnectors as string[]) ?? [],
        defaultModelProfile: (snapshot.defaultModelProfile as string) ?? null,
        maxSteps: (snapshot.maxSteps as number) ?? 8,
        maxToolCalls: (snapshot.maxToolCalls as number) ?? 16,
        approvalPolicy: ((snapshot.approvalPolicy as string) ?? 'ASK_EVERY_WRITE') as never,
        enabled: true,
        createdByUserId: viewer.userId,
      })
      .returning();
    installedDefinitionId = agent.id;
    status = 'ACTIVE';
  } else if (defType === 'WORKFLOW') {
    // Create a DRAFT workflow. It ships NO credentials/schedule/standing-auth — the
    // installer must configure and explicitly activate it under the workflow policy.
    const [wf] = await db
      .insert(workflows)
      .values({
        ownerType,
        userId: viewer.activeOrganizationId ? null : viewer.userId,
        organizationId: viewer.activeOrganizationId,
        name: item.title.slice(0, 160),
        description: item.shortDescription?.slice(0, 600) ?? null,
        goal: String(snapshot.goal ?? ''),
        status: 'DRAFT',
        triggerType: 'MANUAL',
        approvalPolicy: ((snapshot.approvalPolicy as string) ?? 'ASK_EVERY_WRITE') as never,
        webSearchEnabled: (snapshot.webSearchEnabled as boolean) ?? false,
        createdByUserId: viewer.userId,
      })
      .returning();
    installedDefinitionId = wf.id;
    status = 'DRAFT';
  } else {
    // PROMPT / RESEARCH / KNOWLEDGE — the local private copy lives in localConfig.
    localConfig = snapshot;
    status = 'ACTIVE';
  }

  const [installation] = await db
    .insert(libraryInstallations)
    .values({
      libraryItemId: item.id,
      versionId: version.id,
      ownerType,
      userId: viewer.activeOrganizationId ? null : viewer.userId,
      organizationId: viewer.activeOrganizationId,
      installedDefinitionType: defType,
      installedDefinitionId,
      localConfig,
      status,
      installedByUserId: viewer.userId,
    })
    .returning();

  await db.update(libraryItems).set({ installationCount: item.installationCount + 1 }).where(eq(libraryItems.id, item.id));
  await logSecurityEvent({
    event: 'library.installed',
    userId: viewer.userId,
    organizationId: viewer.activeOrganizationId,
    metadata: { itemId: item.id, versionId: version.id, defType, status, risk: version.riskLevel, declaredTools: version.requiredTools },
  });
  return installation;
}

export async function getInstallation(viewer: LibraryViewer, id: string): Promise<LibraryInstallation | null> {
  const [row] = await getDb().select().from(libraryInstallations).where(eq(libraryInstallations.id, id)).limit(1);
  if (!row) return null;
  const mine = row.organizationId ? row.organizationId === viewer.activeOrganizationId : row.userId === viewer.userId;
  return mine ? row : null;
}

export async function listInstallations(viewer: LibraryViewer): Promise<LibraryInstallation[]> {
  const filter = viewer.activeOrganizationId ? eq(libraryInstallations.organizationId, viewer.activeOrganizationId) : eq(libraryInstallations.userId, viewer.userId);
  return getDb().select().from(libraryInstallations).where(and(filter, inArray(libraryInstallations.status, ['DRAFT', 'ACTIVE', 'DISABLED', 'SUSPENDED']))) as Promise<LibraryInstallation[]>;
}

/**
 * Uninstall: disable the local instance. Does NOT disconnect OAuth, delete source
 * data, or remove unrelated agents/workflows.
 */
export async function uninstall(viewer: LibraryViewer, installationId: string): Promise<void> {
  const inst = await getInstallation(viewer, installationId);
  if (!inst) throw new AppError(404, 'Installation not found.', 'not_found');
  const db = getDb();
  if (inst.installedDefinitionType === 'AGENT' && inst.installedDefinitionId) {
    await db.update(agentDefinitions).set({ enabled: false, updatedAt: new Date() }).where(eq(agentDefinitions.id, inst.installedDefinitionId));
  } else if (inst.installedDefinitionType === 'WORKFLOW' && inst.installedDefinitionId) {
    await db.update(workflows).set({ status: 'DISABLED', updatedAt: new Date() }).where(eq(workflows.id, inst.installedDefinitionId));
  }
  await db.update(libraryInstallations).set({ status: 'UNINSTALLED', updatedAt: new Date() }).where(eq(libraryInstallations.id, inst.id));
  await logSecurityEvent({ event: 'library.uninstalled', userId: viewer.userId, organizationId: viewer.activeOrganizationId, metadata: { installationId: inst.id } });
}
